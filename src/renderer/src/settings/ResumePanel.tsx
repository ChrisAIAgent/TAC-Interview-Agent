import React, { useState } from 'react'
import type { Resume } from '../shared/resume'
export function emptyResume():Resume {return {id:'default',title:'我的简历',updatedAt:new Date().toISOString(),personal:{fullName:'',skills:[]},experiences:[],projects:[],education:[],customSections:[]}}
const id=():string=>crypto.randomUUID()
const lines=(value:string):string[]=>value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)
export function ResumePanel({resume,setResume}:{resume:Resume;setResume:(value:Resume)=>void}):React.JSX.Element {
  const [message,setMessage]=useState(''),[raw,setRaw]=useState('')
  const update=(patch:Partial<Resume>):void=>setResume({...resume,...patch})
  const save=async():Promise<void>=>{try{setResume(await window.interviewAPI.saveResume({...resume,updatedAt:new Date().toISOString()}));setMessage('简历已保存在本机。')}catch{setMessage('保存失败，请检查简历内容。')}}
  function importText():void {
    const rows=lines(raw);if(!rows.length)return
    let section='其他',skills:string[]=[];const groups:Record<string,string[]>={工作:[],项目:[],教育:[],其他:[]}
    for(const line of rows){
      const heading=line.replace(/[：:\s]/g,'')
      if(/^(工作经历|工作经验|任职经历)$/.test(heading)){section='工作';continue}
      if(/^(项目经历|项目经验|代表项目)$/.test(heading)){section='项目';continue}
      if(/^(教育经历|教育背景)$/.test(heading)){section='教育';continue}
      if(/^(专业技能|技能|技术栈)$/.test(heading)){section='技能';continue}
      if(section==='技能')skills.push(...line.split(/[,，、;；]/).map(x=>x.trim()).filter(Boolean))
      else groups[section].push(line)
    }
    const patch:Partial<Resume>={personal:{...resume.personal,skills:skills.length?skills:resume.personal.skills},rawText:raw}
    if(groups.工作.length)patch.experiences=[...resume.experiences,{id:id(),company:'',role:'',highlights:groups.工作}]
    if(groups.项目.length)patch.projects=[...resume.projects,{id:id(),name:'',highlights:groups.项目}]
    if(groups.教育.length)patch.education=[...resume.education,{id:id(),school:groups.教育.join('；')}]
    if(groups.其他.length)patch.customSections=[...resume.customSections,{id:id(),title:'导入待整理',items:groups.其他}]
    update(patch);setMessage('已按标题初步整理；请核对公司、职位和项目后再保存。')
  }
  return <section className="card" id="step-resume"><div className="section-heading"><div><span className="number">02 / OPTIONAL</span><h2>简历资料（可选）</h2></div><span className="badge">本机保存</span></div>
    <p className="muted">没有简历也能试答。建议先补充技能和一段真实经历；生成回答时，相关片段会发送至你选择的模型服务商。</p>
    <details className="quick-import"><summary>快速导入：粘贴简历文本</summary><p className="muted">按“工作经历 / 项目经历 / 教育经历 / 技能”标题初步整理。导入后请核对分类和内容，再保存；不会自动编造字段。</p><textarea value={raw} onChange={e=>setRaw(e.target.value)} placeholder="在这里粘贴简历文本"/><button type="button" onClick={importText}>整理到下方表单</button></details>
    <div className="form-grid"><label>简历名称<input value={resume.title} onChange={e=>update({title:e.target.value})}/></label><label>姓名<input value={resume.personal.fullName} onChange={e=>update({personal:{...resume.personal,fullName:e.target.value}})}/></label><label>职位<input value={resume.personal.title??''} onChange={e=>update({personal:{...resume.personal,title:e.target.value}})}/></label><label>经验年数<input type="number" min="0" max="80" value={resume.personal.yearsOfExperience??''} onChange={e=>update({personal:{...resume.personal,yearsOfExperience:e.target.value===''?undefined:Number(e.target.value)}})}/></label><label className="wide">技能（逗号分隔）<input value={resume.personal.skills.join('，')} onChange={e=>update({personal:{...resume.personal,skills:e.target.value.split(/[,，]/)}})}/></label></div>
    <h3>工作经历</h3>{resume.experiences.map((row,index)=><div className="editor-block" key={row.id}><div className="form-grid"><label>公司<input value={row.company} onChange={e=>update({experiences:resume.experiences.map((x,i)=>i===index?{...x,company:e.target.value}:x)})}/></label><label>职位<input value={row.role} onChange={e=>update({experiences:resume.experiences.map((x,i)=>i===index?{...x,role:e.target.value}:x)})}/></label><label>开始（YYYY-MM）<input value={row.startDate??''} onChange={e=>update({experiences:resume.experiences.map((x,i)=>i===index?{...x,startDate:e.target.value}:x)})}/></label><label>结束（空为至今）<input value={row.endDate??''} onChange={e=>update({experiences:resume.experiences.map((x,i)=>i===index?{...x,endDate:e.target.value}:x)})}/></label><label className="wide">成果要点（每行一条）<textarea value={row.highlights.join('\n')} onChange={e=>update({experiences:resume.experiences.map((x,i)=>i===index?{...x,highlights:e.target.value.split('\n')}:x)})}/></label></div><button type="button" onClick={()=>update({experiences:resume.experiences.filter((_,i)=>i!==index)})}>移除此经历</button></div>)}
    <button type="button" onClick={()=>update({experiences:[...resume.experiences,{id:id(),company:'',role:'',highlights:[]}]})}>＋ 添加工作经历</button>
    <h3>项目经历</h3>{resume.projects.map((row,index)=><div className="editor-block" key={row.id}><div className="form-grid"><label>项目名称<input value={row.name} onChange={e=>update({projects:resume.projects.map((x,i)=>i===index?{...x,name:e.target.value}:x)})}/></label><label>角色<input value={row.role??''} onChange={e=>update({projects:resume.projects.map((x,i)=>i===index?{...x,role:e.target.value}:x)})}/></label><label className="wide">个人贡献<textarea value={row.contribution??''} onChange={e=>update({projects:resume.projects.map((x,i)=>i===index?{...x,contribution:e.target.value}:x)})}/></label><label className="wide">结果<input value={row.result??''} onChange={e=>update({projects:resume.projects.map((x,i)=>i===index?{...x,result:e.target.value}:x)})}/></label><label className="wide">其他要点（每行一条）<textarea value={row.highlights.join('\n')} onChange={e=>update({projects:resume.projects.map((x,i)=>i===index?{...x,highlights:e.target.value.split('\n')}:x)})}/></label></div><button type="button" onClick={()=>update({projects:resume.projects.filter((_,i)=>i!==index)})}>移除此项目</button></div>)}
    <button type="button" onClick={()=>update({projects:[...resume.projects,{id:id(),name:'',highlights:[]}]})}>＋ 添加项目</button>
    <h3>教育经历</h3>{resume.education.map((row,index)=><div className="editor-block" key={row.id}><div className="form-grid"><label>学校<input value={row.school} onChange={e=>update({education:resume.education.map((x,i)=>i===index?{...x,school:e.target.value}:x)})}/></label><label>专业<input value={row.major??''} onChange={e=>update({education:resume.education.map((x,i)=>i===index?{...x,major:e.target.value}:x)})}/></label></div><button type="button" onClick={()=>update({education:resume.education.filter((_,i)=>i!==index)})}>移除此教育经历</button></div>)}
    <button type="button" onClick={()=>update({education:[...resume.education,{id:id(),school:''}]})}>＋ 添加教育经历</button>
    <h3>其他信息</h3>{resume.customSections.map((row,index)=><div className="editor-block" key={row.id}><div className="form-grid"><label>标题<input value={row.title} onChange={e=>update({customSections:resume.customSections.map((x,i)=>i===index?{...x,title:e.target.value}:x)})}/></label><label className="wide">内容（每行一条）<textarea value={row.items.join('\n')} onChange={e=>update({customSections:resume.customSections.map((x,i)=>i===index?{...x,items:e.target.value.split('\n')}:x)})}/></label></div><button type="button" onClick={()=>update({customSections:resume.customSections.filter((_,i)=>i!==index)})}>移除此项</button></div>)}
    <button type="button" onClick={()=>update({customSections:[...resume.customSections,{id:id(),title:'',items:[]}]})}>＋ 添加其他信息</button>
    {message&&<p role="status" className="muted">{message}</p>}<div className="action-line"><button type="button" className="primary" onClick={()=>void save()}>保存简历</button></div>
  </section>
}
