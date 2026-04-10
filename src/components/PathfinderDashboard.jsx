import React, { useState, useRef, useEffect } from 'react';

export default function PathfinderDashboard() {
  const [messages, setMessages] = useState([
    { role: 'agent', text: "Hello. I'm Zoya, your Advocate. I'm here to coordinate your legal and support path with empathy and safety. Are you in a safe space to talk right now?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Zoya 2.2 States
  const [docDatabase, setDocDatabase] = useState([]);
  const [caseFile, setCaseFile] = useState({
    name: null, safety: "Establishing...", financial: null, legal: null, children: null
  });

  // Intake Progress (Now moved to chat history area)
  const [currentTask, setCurrentTask] = useState({
    type: 'choice',
    label: 'Identify Need',
    options: ['Legal Protection', 'Financial Support', 'Emergency Housing']
  });

  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, currentTask]);

  const handleAction = async (val) => {
    const textToSend = val || input;
    if (!textToSend.trim()) return;

    const userMsg = { role: 'user', text: textToSend };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history })
      });
      const data = await res.json();
      
      setMessages(prev => [...prev, { role: 'agent', text: data.reply }]);
      
      // Update interactive intake
      setCurrentTask({
        type: data.inputType || 'text',
        label: data.inputLabel || 'Provide details',
        options: data.options || []
      });

      if (data.extractedFacts) setCaseFile(prev => ({ ...prev, ...data.extractedFacts }));
      
      if (data.newDocRequirement) {
        setDocDatabase(prev => {
          if (prev.some(d => d.name === data.newDocRequirement)) return prev;
          return [...prev, { name: data.newDocRequirement, uploaded: false }];
        });
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'agent', text: 'Connection lost.' }]);
    } finally {
      setLoading(false);
    }
  };

  const markDocUploaded = (idx) => {
    setDocDatabase(prev => {
      const clone = [...prev];
      clone[idx].uploaded = true;
      return clone;
    });
  };

  const handleFillForm = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('caseFile', JSON.stringify(caseFile));
      formData.append('template', file);
      const res = await fetch('http://localhost:3001/api/fill-document', { method: 'POST', body: formData });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Zoya_Filled_${file.name}`;
      a.click();
    } catch (err) { alert("Failed to fill form."); }
    finally { setLoading(false); }
  };

  const requiredDocs = docDatabase.filter(d => !d.uploaded);
  const submittedDocs = docDatabase.filter(d => d.uploaded);

  return (
    <div className="dashboard-container">
      
      {/* LEFT PANEL: DOC DATABASE */}
      <aside className="panel left-panel">
        <header className="panel-header">
           <h2>Doc Database</h2>
        </header>
        
        <div className="doc-list">
          <span className="task-label">Action Needed</span>
          {requiredDocs.length === 0 ? <p style={{fontSize:'0.75rem', color:'#64748b', marginBottom:'1rem'}}>All identified docs submitted.</p> : 
            requiredDocs.map((doc, idx) => (
              <div key={idx} className="doc-item">
                <div className="doc-name">{doc.name}</div>
                <div className="mini-upload-btn-wrapper">
                  <button className="mini-upload-btn">Submit Document</button>
                  <input type="file" onChange={() => markDocUploaded(docDatabase.findIndex(d => d.name === doc.name))} />
                </div>
              </div>
            ))
          }

          {submittedDocs.length > 0 && <hr style={{margin: '1.5rem 0', opacity: 0.1}} />}
          
          <span className="task-label">Secure Repository</span>
          {submittedDocs.map((doc, idx) => (
            <div key={idx} className="doc-item done">
              <div className="doc-name">{doc.name}</div>
              <span className="check-icon">✓ SECURED</span>
            </div>
          ))}
        </div>
      </aside>

      {/* MAIN: CHAT HISTORY */}
      <main className="panel chat-panel">
         <header className="panel-header">
           <h2 style={{color:'#8b5cf6'}}>Zoya Advocate</h2>
           <div className="status-indicator">Private Connection</div>
         </header>
         
         <div className="chat-messages">
           {messages.map((m, i) => <div key={i} className={`bubble ${m.role}`}>{m.text}</div>)}
           
           {!loading && currentTask && (
              <div className="bubble agent intake-bubble">
                <p style={{marginBottom: '1rem', fontWeight: 700, color: '#8b5cf6', fontSize: '0.9rem'}}>{currentTask.label}</p>
                {currentTask.type === 'choice' ? (
                  <div className="option-grid">
                    {currentTask.options.map((opt, i) => (
                      <button key={i} className="pill-btn" onClick={() => handleAction(opt)}>
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="dedicated-field">
                    <input 
                      type="text" 
                      placeholder="Type your response..." 
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAction()}
                    />
                    <button className="send-btn" onClick={() => handleAction()}>OK</button>
                  </div>
                )}
              </div>
           )}

           {loading && <div className="typing"><div className="dot" /><div className="dot" /><div className="dot" /></div>}
           <div ref={scrollRef} />
         </div>

         <div className="chat-footer">
            <input 
              type="text" 
              placeholder="Ask Zoya anything..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAction()}
            />
            <button className="primary-btn" onClick={() => handleAction()}>Send</button>
         </div>
      </main>

      {/* RIGHT: LIVE CASE FILE */}
      <aside className="panel right-panel">
        <header className="panel-header">
           <h2>Live Case File</h2>
        </header>
        <div className="case-content">
           <div className={`case-card ${caseFile.name ? 'active' : ''}`}>
              <div className="card-header">Client Identity</div>
              <div className="card-body">{caseFile.name || 'Establishing...'}</div>
           </div>
           <div className={`case-card ${caseFile.children ? 'active' : ''}`}>
              <div className="card-header">Children / Family</div>
              <div className="card-body">{caseFile.children || 'Collecting details...'}</div>
           </div>
           <div className={`case-card ${caseFile.financial ? 'active' : ''}`}>
              <div className="card-header">Financial Support</div>
              <div className="card-body">{caseFile.financial || 'Analysis pending...'}</div>
           </div>
           <div className={`case-card ${caseFile.legal ? 'active' : ''}`}>
              <div className="card-header">Legal Record</div>
              <div className="card-body">{caseFile.legal || 'Building incident map...'}</div>
           </div>
           
           <div style={{marginTop:'auto', padding:'1.5rem', background:'#f8fafc', borderRadius:'20px', border:'1px solid #e2e8f0'}}>
              <h4 style={{fontSize:'0.85rem', color:'#8b5cf6', marginBottom:'0.5rem', fontWeight: 800}}>Form Autofill</h4>
              <p style={{fontSize:'0.7rem', color:'#64748b', marginBottom:'1.2rem', lineHeight: 1.4}}>Map your Case File details to any official blank PDF or DOCX.</p>
              <div className="mini-upload-btn-wrapper">
                 <button className="primary-btn" style={{width:'100%'}}>Upload & Fill Blank</button>
                 <input type="file" onChange={handleFillForm} accept=".pdf,.docx"/>
              </div>
           </div>
        </div>
      </aside>

    </div>
  );
}
