import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ModInfo } from '../types'

const SELF = 'mod-manager'
const PANE = 'mod-manager'
const MENU = '__menu'
const ALL_ON = '__all_on'
const ALL_OFF = '__all_off'

const mods = atom({ plugin: 'mod-manager', key: 'mods' } as const, [])
const disabled = atom({ plugin: 'mod-manager', key: 'disabled' } as const, [])
const pending = atom({ plugin: 'mod-manager', key: 'pending' } as const, [])
const isDirty = atom({ plugin: 'mod-manager', key: 'isDirty' } as const, false)

type Known = Record<string, ModInfo>

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

// The store key for this session's choices; 'defaults' when no id is known.
const sessionKey = async ($: any): Promise<string> => {
  try {
    return `s:${await $.session.id()}`
  } catch {
    return 'defaults'
  }
}

// This session's switched-off mods, falling back to the saved defaults.
const loadOff = async ($: any): Promise<string[]> => {
  const own = await $.store.get(await sessionKey($))
  const fallback = await $.store.get('defaults')
  const list = Array.isArray(own) ? asList(own) : asList(fallback)
  return list.filter(name => name !== SELF)
}

const loadKnown = async ($: any): Promise<Known> => {
  const known = await $.store.get('known')
  return known && typeof known === 'object' ? (known as Known) : {}
}

const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}/${b}`

// Does this folder hold a mod? It needs a manifest and a hooks.json with modules.
const readMod = async ($: any, dir: string, source: string): Promise<ModInfo | undefined> => {
  try {
    const manifest = JSON.parse(await $.fs.read(join(dir, '.claude-plugin/plugin.json')))
    const hooks = JSON.parse(await $.fs.read(join(dir, 'hooks/hooks.json')))
    if (typeof manifest.name !== 'string' || !Array.isArray(hooks.modules)) return undefined
    return { name: manifest.name, version: String(manifest.version ?? '0'), tier: 'user', source }
  } catch {
    return undefined
  }
}

// Walks a root looking for mod folders, a few levels deep.
const walk = async ($: any, dir: string, source: string, depth: number, out: Known) => {
  const found = await readMod($, dir, source)
  if (found) {
    out[found.name] = found
    return
  }
  if (depth <= 0) return
  try {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind === 'directory' && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await walk($, join(dir, entry.name), source, depth - 1, out)
      }
    }
  } catch {}
}

// Every global place a mod can live on this machine.
const scanGlobal = async ($: any): Promise<Known> => {
  const out: Known = {}
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const roots: Array<[string, string, number]> = []
  if (home) {
    const claude = join(home, '.claude')
    roots.push([join(claude, 'dev-mods'), 'dev-mods', 2])
    roots.push([join(claude, 'plugins/synced'), 'synced', 3])
    roots.push([join(claude, 'plugins/marketplaces'), 'marketplace', 4])
    roots.push([join(claude, 'skills'), 'skills', 1])
  }
  const dirs = (await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? ''
  for (const dir of String(dirs).split(/[;:](?![\\/])/).filter(Boolean)) {
    roots.push([dir.trim(), 'plugin-dir', 0])
  }
  const root: string = $.plugin.root
  roots.push([root.slice(0, Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))), 'sibling', 1])
  for (const [dir, source, depth] of roots) {
    await walk($, dir, source, depth, out)
  }
  return out
}

const syncAtoms = async ($: any) => {
  const merged: Known = { ...(await scanGlobal($)), ...(await loadKnown($)) }
  merged[SELF] = { name: SELF, version: merged[SELF]?.version ?? '0.1.0', tier: 'user', source: 'this manager' }
  const list = Object.values(merged).sort((a, b) => a.name.localeCompare(b.name))
  const off = await loadOff($)
  const waiting = asList(await $.store.get('pending'))
  await update($, mods, () => list)
  await update($, disabled, () => off)
  await update($, pending, () => waiting)
}

const saveOff = async ($: any, off: string[]) => {
  await $.store.set(await sessionKey($), off)
  await update($, disabled, () => off)
  await update($, isDirty, () => true)
}

const toggle = async ($: any, name: string) => {
  if (name === SELF) {
    $.ui.toast('mod-manager stays on so you can turn the others back on')
    return
  }
  const off = await loadOff($)
  const isOff = off.includes(name)
  await saveOff($, isOff ? off.filter(n => n !== name) : [...off, name])
  $.ui.toast(`${name} ${isOff ? 'enabled' : 'disabled'} · press Apply to load the change`)
}

const setAll = async ($: any, isOn: boolean) => {
  const names = Object.keys({ ...(await scanGlobal($)), ...(await loadKnown($)) }).filter(n => n !== SELF)
  await saveOff($, isOn ? [] : names)
}

// A save inside this folder makes the hot-reloading engine load every mod again,
// and plugin.register then refuses the ones switched off.
const apply = async ($: any) => {
  await $.fs.write(`${$.plugin.root}/hooks/.reload`, String(await $.clock.now()))
  await update($, isDirty, () => false)
  $.ui.toast('Applying mod selection…')
}

// The person's answer for a mod seen for the first time.
const decide = async ($: any, name: string, isOn: boolean) => {
  const approved = asList(await $.store.get('approved'))
  await $.store.set('approved', [...new Set([...approved, name])])
  const waiting = asList(await $.store.get('pending')).filter(n => n !== name)
  await $.store.set('pending', waiting)
  await update($, pending, () => waiting)
  const off = (await loadOff($)).filter(n => n !== name)
  await $.store.set(await sessionKey($), isOn ? off : [...off, name])
  await update($, disabled, () => (isOn ? off : [...off, name]))
  if (isOn) {
    await apply($)
  } else {
    $.ui.toast(`${name} kept off for this session`)
  }
}

export const register: Register = on => {
  on('plugin.register', async ($, e, next) => {
    try {
      const known = await loadKnown($)
      known[e.name] = { name: e.name, version: e.version ?? '0', tier: e.tier, source: e.provenance }
      await $.store.set('known', known)
      if (e.name !== SELF) {
        const approved = asList(await $.store.get('approved'))
        if (!approved.includes(e.name)) {
          if ((await $.store.get('bootstrapped')) !== true) {
            // First run: every mod already here counts as known.
            await $.store.set('approved', [...approved, e.name])
          } else if (e.tier === 'user') {
            const waiting = asList(await $.store.get('pending'))
            await $.store.set('pending', [...new Set([...waiting, e.name])])
            return { refuse: 'new mod, waiting for your approval in mod-manager' }
          }
        }
        if (e.tier === 'user' && (await loadOff($)).includes(e.name)) {
          return { refuse: 'switched off for this session by mod-manager' }
        }
      }
    } catch {}

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods',
      description: 'Open the mod manager: choose which mods run in this session',
    })
    await $.store.set('bootstrapped', true)
    await syncAtoms($)
    const waiting = asList(await $.store.get('pending'))
    if (waiting.length > 0) {
      $.ui.toast(`New mod detected: ${waiting.join(', ')} · choose Enable or Keep off in the MODS bar`)
    }

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await syncAtoms($)
    await $.ui.open({ id: PANE, title: 'Mods' })

    return { text: 'Mod manager opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'mobile' || e.props.hasSurvey) {
      return next(e)
    }
    const list = await read($, mods)
    if (list.length === 0) {
      return next(e)
    }
    const off = await read($, disabled)
    const waiting = await read($, pending)
    const dirty = await read($, isDirty)
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const onCount = list.filter(m => !off.includes(m.name) && !waiting.includes(m.name)).length

    const options = [
      { value: MENU, label: `Mods ▾  ${onCount}/${list.length} on` },
      ...list.map(m => ({
        value: m.name,
        label:
          m.name === SELF
            ? `🔒 ${m.name} · always on`
            : waiting.includes(m.name)
              ? `✦ ${m.name} · new, awaiting your choice`
              : `${off.includes(m.name) ? '○' : '●'} ${m.name} v${m.version}${off.includes(m.name) ? ' · off' : ''} · ${m.source}`,
      })),
      { value: ALL_ON, label: '✓ Enable all' },
      { value: ALL_OFF, label: '✕ Disable all' },
    ]

    return (
      <Box flexDirection="column">
        {waiting.slice(0, 3).map(name => {
          const info = list.find(m => m.name === name)
          return (
            <Box key={`new:${name}`} paddingX={1} gap={1} borderStyle="round" borderColor="magenta">
              <Text bold color="magenta">
                ✦ NEW MOD
              </Text>
              <Text>
                {name}
                {info ? ` v${info.version}` : ''}
              </Text>
              <Text dimColor>enable it for this session?</Text>
              <Button key={`yes:${name}`} variant="primary" label="Enable" onPress={() => decide($, name, true)} />
              <Button key={`no:${name}`} label="Keep off" onPress={() => decide($, name, false)} />
            </Box>
          )
        })}
        <Box paddingX={1} gap={1} borderStyle="round" borderColor={dirty ? 'yellow' : 'cyan'}>
          <Text bold color="cyan">
            ⬢ MODS
          </Text>
          <Select
            key="menu"
            options={options}
            value={MENU}
            onSelect={async v => {
              if (v === MENU) return
              if (v === ALL_ON) return setAll($, true)
              if (v === ALL_OFF) return setAll($, false)
              if (waiting.includes(v)) return decide($, v, true)
              return toggle($, v)
            }}
          />
          {dirty && <Text color="yellow">● pending</Text>}
          {dirty && <Button key="apply" variant="primary" label="↻ Apply" hotkey="a" onPress={() => apply($)} />}
          <Button
            key="panel"
            label="⚙ Manage"
            plain
            dimColor
            hotkey="m"
            onPress={() => $.ui.open({ id: PANE, title: 'Mods' })}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, mods)
    const off = await read($, disabled)
    const waiting = await read($, pending)
    const dirty = await read($, isDirty)

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            ⬢ Mod Manager
          </Text>
          <Text dimColor>
            {list.filter(m => !off.includes(m.name) && !waiting.includes(m.name)).length}/{list.length} on in this
            session
          </Text>
        </Box>
        <Box flexDirection="column">
          {list.map(m => {
            const isNew = waiting.includes(m.name)
            const isOff = off.includes(m.name) || isNew
            const isSelf = m.name === SELF
            return (
              <Box
                key={`row:${m.name}`}
                borderStyle="round"
                borderColor={isNew ? 'magenta' : isOff ? 'gray' : 'green'}
                paddingX={1}
                justifyContent="space-between"
              >
                <Box flexDirection="column">
                  <Text bold dimColor={isOff && !isNew}>
                    {isNew ? '✦' : isOff ? '○' : '●'} {m.name} v{m.version}
                    {isNew ? '  NEW' : ''}
                  </Text>
                  <Text dimColor>{m.source}</Text>
                </Box>
                <Box gap={1}>
                  {isNew && <Button key={`keep:${m.name}`} label="Keep off" onPress={() => decide($, m.name, false)} />}
                  <Button
                    key={`t:${m.name}`}
                    variant={isOff ? 'primary' : 'secondary'}
                    label={isSelf ? '🔒 locked' : isNew ? 'Enable' : isOff ? 'Enable' : 'Disable'}
                    onPress={() => (isNew ? decide($, m.name, true) : toggle($, m.name))}
                  />
                </Box>
              </Box>
            )
          })}
        </Box>
        <Box gap={1}>
          <Button key="on" label="✓ All on" onPress={() => setAll($, true)} />
          <Button key="off" label="✕ All off" onPress={() => setAll($, false)} />
          <Button
            key="default"
            label="★ Save as default"
            onPress={async () => {
              await $.store.set('defaults', await loadOff($))
              $.ui.toast('Saved as the default for new sessions')
            }}
          />
          {dirty && <Button key="apply" variant="primary" label="↻ Apply" onPress={() => apply($)} />}
        </Box>
        {dirty && <Text color="yellow">Changes load when you press Apply (the mods reload).</Text>}
      </Box>
    )
  })
}
