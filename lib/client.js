/**
 * dsh-custom-system-prompt — browser client bundle.
 *
 * One card in the plugin-configuration section (settings.plugin.item):
 * pick a live session, type a system prompt, save. The card talks to the
 * host's loopback-only config routes; values persist through the `settings`
 * service and are injected into that session's prompt on the next model step.
 */
window.__ModuleLoader__.load({ id: 'dsh-custom-system-prompt', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')
  const { useEffect, useRef, useState } = React

  const BASE = '/plugins/dsh-custom-system-prompt'
  const CONFIG_URL = `${BASE}/config`
  const SESSIONS_URL = `${BASE}/sessions`

  const cardStyle = {
    listStyle: 'none', border: '1px solid var(--border-color, #d8d8d8)', borderRadius: 12,
    padding: 16, background: 'var(--surface-color, transparent)', display: 'grid', gap: 12,
  }
  const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }
  const textStyle = { flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-color, #d8d8d8)', background: 'var(--input-color, transparent)', color: 'inherit' }
  const taStyle = { width: '100%', boxSizing: 'border-box', minHeight: 140, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color, #d8d8d8)', background: 'var(--input-color, transparent)', color: 'inherit', fontFamily: 'monospace', resize: 'vertical' }
  const selectStyle = { minWidth: 120, padding: '6px 10px', borderRadius: 8, color: 'inherit', background: 'var(--surface-color, transparent)' }

  const readJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`request failed: ${response.status}`)
    return response.json()
  }

  function Field({ label, hint, children }) {
    return React.createElement('label', { style: rowStyle },
      React.createElement('span', null,
        React.createElement('span', { style: { display: 'block', fontWeight: 600 } }, label),
        hint ? React.createElement('small', { style: { display: 'block', opacity: 0.65, marginTop: 2 } }, hint) : null,
      ),
      children,
    )
  }

  function SettingsCard() {
    const [status, setStatus] = useState('loading')
    const [sessionIds, setSessionIds] = useState([])
    const [selected, setSelected] = useState('')
    const [text, setText] = useState('')
    const [savedText, setSavedText] = useState('')
    const [busy, setBusy] = useState(false)
    const seq = useRef(0)

    const load = (active = true) => {
      return Promise.all([readJson(SESSIONS_URL), readJson(CONFIG_URL)])
        .then(([sessionsRes, configRes]) => {
          if (!active) return
          const ids = sessionsRes.sessions ?? []
          const map = configRes.sessions ?? {}
          setSessionIds(ids)
          const current = active && ids.includes(selected) ? selected : (ids[0] ?? '')
          setSelected(current)
          setText(map[current] ?? '')
          setSavedText(map[current] ?? '')
          setStatus('ready')
        })
        .catch(() => { if (active) setStatus('unavailable') })
    }

    useEffect(() => {
      let active = true
      void load(active)
      return () => { active = false }
    }, [])

    const pickSession = (id) => {
      setSelected(id)
      return readJson(CONFIG_URL)
        .then((configRes) => {
          const map = configRes.sessions ?? {}
          setText(map[id] ?? '')
          setSavedText(map[id] ?? '')
        })
        .catch(() => setStatus('unavailable'))
    }

    const save = () => {
      if (!selected) return
      const mine = ++seq.current
      setBusy(true)
      fetch(CONFIG_URL, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: selected, text }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            throw new Error(body.error ?? `write failed: ${response.status}`)
          }
          if (mine === seq.current) {
            setSavedText(text)
            setStatus('ready')
          }
        })
        .catch((error) => { if (mine === seq.current) setStatus(`save failed: ${error.message}`) })
        .finally(() => { if (mine === seq.current) setBusy(false) })
    }

    const clear = () => {
      if (!selected) return
      setText('')
      const mine = ++seq.current
      setBusy(true)
      fetch(CONFIG_URL, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: selected, text: '' }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            throw new Error(body.error ?? `write failed: ${response.status}`)
          }
          if (mine === seq.current) {
            setSavedText('')
            setStatus('ready')
          }
        })
        .catch((error) => { if (mine === seq.current) setStatus(`clear failed: ${error.message}`) })
        .finally(() => { if (mine === seq.current) setBusy(false) })
    }

    const ready = status === 'ready'
    const dirty = text !== savedText

    return React.createElement('li', { style: cardStyle, 'data-testid': 'dsh-custom-system-prompt-settings' },
      React.createElement('div', null,
        React.createElement('strong', { style: { fontSize: 16 } }, '自定义系统提示'),
        React.createElement('p', { style: { margin: '4px 0 0', opacity: 0.72 } }, '按会话注入系统提示：选择会话、写入文本、保存，该会话下一轮模型调用即带上。重启进程后设置保留。'),
      ),
      status === 'unavailable'
        ? React.createElement('span', { role: 'status' }, '设置尚未连接到 DSH Host。')
        : status === 'loading'
        ? React.createElement('span', null, '正在读取设置…')
        : React.createElement(React.Fragment, null,
          Field({ label: '目标会话', hint: '当前打开的会话列表（新会话需刷新后出现）。',
            children: React.createElement('select', {
              style: selectStyle, value: selected, disabled: !ready || busy,
              onChange: (event) => void pickSession(event.target.value),
            },
            sessionIds.length === 0
              ? React.createElement('option', { value: '' }, '（无活跃会话）')
              : sessionIds.map((id) => React.createElement('option', { key: id, value: id }, id))),
          }),
          React.createElement('textarea', {
            style: taStyle, value: text, disabled: !ready || busy || !selected,
            placeholder: '在这里写该系统提示……（留空则清除注入）',
            onChange: (event) => setText(event.target.value),
          }),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('button', {
              style: { padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border-color, #d8d8d8)', background: 'var(--brand-color, #4c6fff)', color: '#fff' },
              onClick: save, disabled: !ready || busy || !selected || !dirty,
            }, '保存'),
            React.createElement('button', {
              style: { padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border-color, #d8d8d8)', background: 'transparent', color: 'inherit' },
              onClick: clear, disabled: !ready || busy || !selected || !savedText,
            }, '清除'),
          ),
        ),
    )
  }

  function apply(ctx) {
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'dsh-custom-system-prompt',
      key: 'dsh-custom-system-prompt',
      order: 50,
      inject: () => ({}),
    }, SettingsCard))
  }

  module.exports = {
    name: 'dsh-custom-system-prompt-client',
    inject: ['slots'],
    apply,
  }
  return module.exports
} })
