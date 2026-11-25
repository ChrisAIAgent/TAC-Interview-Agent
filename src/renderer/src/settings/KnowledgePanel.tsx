import React, { useState } from 'react'
import { KNOWLEDGE_KEY, type KnowledgeEntry } from '../session/knowledge'

const emptyEntry = (): KnowledgeEntry => ({
  id: '', title: '', content: '', tags: [], sources: [], verifiedAt: '', kind: 'guidance', document: '',
})
const kindLabel: Record<KnowledgeEntry['kind'], string> = { guidance: '运营建议', case: '公开案例', experience: '真实经历' }

function KnowledgeEditor({ initial, onSave, submitLabel }: { initial: KnowledgeEntry; onSave: (entry: KnowledgeEntry) => boolean; submitLabel: string }): React.JSX.Element {
  const [entry, setEntry] = useState(initial)
  const [tags, setTags] = useState(initial.tags.join('、'))
  const [sources, setSources] = useState(initial.sources.map(source => `${source.title} | ${source.url}`).join('\n'))
  const [error, setError] = useState('')
  const patch = (value: Partial<KnowledgeEntry>): void => setEntry(previous => ({ ...previous, ...value }))
  const save = (): void => {
    const parsedSources: KnowledgeEntry['sources'] = []
    for (const line of sources.split('\n').map(value => value.trim()).filter(Boolean)) {
      const index = line.indexOf('|')
      const title = index < 0 ? '' : line.slice(0, index).trim()
      const url = index < 0 ? '' : line.slice(index + 1).trim()
      try {
        if (!title || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error()
      } catch {
        setError('来源请每行填写“名称 | https://网址”。')
        return
      }
      parsedSources.push({ title, url })
    }
    const parsedTags = tags.split(/[、,，\n]/u).map(value => value.trim()).filter(Boolean)
    if (parsedTags.length > 30) { setError('标签最多 30 个。'); return }
    const next = { ...entry, title: entry.title.trim(), content: entry.content.trim(), document: entry.document.trim(), tags: parsedTags, sources: parsedSources }
    if (!next.title || !next.content) { setError('请填写主题和资料内容。'); return }
    setError('')
    if (onSave(next)) setEntry(next)
  }
  return <div className="form-grid">
    <label className="wide">主题<input maxLength={200} value={entry.title} onChange={event => patch({ title: event.target.value })} placeholder="例如：如何运营 LinkedIn" /></label>
    <label>资料类型<select value={entry.kind} onChange={event => patch({ kind: event.target.value as KnowledgeEntry['kind'] })}><option value="guidance">运营建议</option><option value="case">公开案例</option><option value="experience">真实经历</option></select></label>
    <label>资料来源名称<input value={entry.document} onChange={event => patch({ document: event.target.value })} placeholder="例如：海外社媒与社区运营指南" /></label>
    <label className="wide">标签（用逗号或顿号分隔）<input value={tags} onChange={event => setTags(event.target.value)} placeholder="例如：LinkedIn、岗位案例、企业线索" /></label>
    <label className="wide">资料内容<textarea maxLength={10000} rows={6} value={entry.content} onChange={event => patch({ content: event.target.value })} placeholder="填写这项主题的内容和适用情境" /></label>
    <label>核验日期<input type="date" value={entry.verifiedAt} onChange={event => patch({ verifiedAt: event.target.value })} /></label>
    <label className="wide">来源链接（每行：名称 | 网址）<textarea rows={3} value={sources} onChange={event => setSources(event.target.value)} placeholder={'例如：官方资料 | https://example.com'} /></label>
    {error && <p className="warning wide" role="alert">{error}</p>}
    <div className="wide"><button type="button" className="primary" onClick={save}>{submitLabel}</button></div>
  </div>
}

export function KnowledgePanel({ entries, setEntries }: { entries: KnowledgeEntry[]; setEntries: (value: KnowledgeEntry[]) => void }): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [newFormVersion, setNewFormVersion] = useState(0)
  const save = (next: KnowledgeEntry[]): boolean => {
    try {
      localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(next))
      setEntries(next)
      setMessage('知识资料已保存在本机。')
      return true
    } catch {
      setMessage('保存失败，请检查本机存储空间。')
      return false
    }
  }
  return <section className="card" id="step-knowledge">
    <div className="section-heading"><div><span className="number">OPTIONAL / KNOWLEDGE</span><h2>知识资料库</h2></div><span className="badge">{entries.length} 条 · 本机保存</span></div>
    <p className="muted">按主题保存运营建议、公开案例和真实经历。相关问题出现时，助手会挑选资料辅助回答；每条最多使用前 650 字，较长内容请拆成多个主题。语义检索会将全部知识主题及问题发送至已配置的模型服务，可能产生额外用量；向量服务不可用时，可能改由回答模型筛选。公开资料可能变化，请留意核验日期。</p>
    <details className="advanced-settings"><summary>＋ 添加知识资料</summary>
      {entries.length >= 500 ? <p className="warning">知识资料最多保存 500 条。</p> : <KnowledgeEditor key={newFormVersion} initial={emptyEntry()} submitLabel="添加资料" onSave={entry => { const ok = save([...entries, { ...entry, id: crypto.randomUUID() }]); if (ok) setNewFormVersion(value => value + 1); return ok }} />}
    </details>
    {entries.map(entry => <details className="editor-block" key={entry.id}>
      <summary><strong>{entry.title}</strong> <span className="muted">{kindLabel[entry.kind]}{entry.verifiedAt ? ` · 核验于 ${entry.verifiedAt}` : ''}</span></summary>
      <KnowledgeEditor key={entry.id} initial={entry} submitLabel="保存修改" onSave={value => save(entries.map(item => item.id === entry.id ? value : item))} />
      <button type="button" onClick={() => save(entries.filter(item => item.id !== entry.id))}>删除资料</button>
    </details>)}
    {message && <p className="muted" role="status">{message}</p>}
  </section>
}
