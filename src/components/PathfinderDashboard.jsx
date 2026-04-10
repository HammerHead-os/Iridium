import React, { useState, useEffect, useRef } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import EmergencyShelters from './EmergencyShelters';

// Helper to prevent [object Object] rendering
const safelyStringify = (val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    if (Array.isArray(val)) return val.map(safelyStringify).join(', ');
    return val.reply || val.text || val.content || val.value || JSON.stringify(val);
  }
  return String(val);
};

export default function PathfinderDashboard({ shelters }) {
  const sortShelters = (sheltersToSort) => {
    const available = sheltersToSort.filter(s => s.status === "available");
    const waitlisted = sheltersToSort.filter(s => s.status === "waitlist").sort((a, b) => a.waitlist - b.waitlist);
    const distant = sheltersToSort.filter(s => s.status === "too_far");

    return [...available, ...waitlisted, ...distant];
  };

  // Load state from localStorage or use defaults
  const loadState = (key, defaultValue) => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : defaultValue;
    } catch (e) {
      console.error(`Failed to load ${key} from localStorage:`, e);
      return defaultValue;
    }
  };

  const [messages, setMessages] = useState(() =>
    loadState('zoya_messages', [
      { role: 'agent', text: "Hello. I'm Zoya, your Advocate. I coordinate HK legal and support paths with absolute privacy. How can I protect you today?" }
    ])
  );
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Zoya States
  const [docDatabase, setDocDatabase] = useState(() => loadState('zoya_docs', []));
  const [caseFile, setCaseFile] = useState(() =>
    loadState('zoya_casefile', {
      name: null, safety: "Establishing...", financial: null, legal: null, children: null
    })
  );

  // PDF Preview States
  const [activeFormType, setActiveFormType] = useState(() => loadState('zoya_formtype', 'cssa'));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Intake Progress
  const [currentTask, setCurrentTask] = useState(() =>
    loadState('zoya_task', {
      type: 'choice',
      label: 'Select Focus Area',
      options: ['Legal Protection', 'Financial Support', 'Emergency Housing'],
      formType: null
    })
  );

  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, currentTask]);

  // Clear all saved data and reset to initial state
  const handleClearChat = () => {
    if (window.confirm('Are you sure you want to clear all conversation history and start fresh?')) {
      localStorage.removeItem('zoya_messages');
      localStorage.removeItem('zoya_casefile');
      localStorage.removeItem('zoya_docs');
      localStorage.removeItem('zoya_task');
      localStorage.removeItem('zoya_formtype');

      setMessages([
        { role: 'agent', text: "Hello. I'm Zoya, your Advocate. I coordinate HK legal and support paths with absolute privacy. How can I protect you today?" }
      ]);
      setCaseFile({
        name: null, safety: "Establishing...", financial: null, legal: null, children: null
      });
      setDocDatabase([]);
      setCurrentTask({
        type: 'choice',
        label: 'Select Focus Area',
        options: ['Legal Protection', 'Financial Support', 'Emergency Housing'],
        formType: null
      });
      setActiveFormType('cssa');
      setPreviewUrl(null);
    }
  };



  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('zoya_messages', JSON.stringify(messages));
    } catch (e) {
      console.error('Failed to save messages to localStorage:', e);
    }
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem('zoya_casefile', JSON.stringify(caseFile));
    } catch (e) {
      console.error('Failed to save caseFile to localStorage:', e);
    }
  }, [caseFile]);

  useEffect(() => {
    try {
      localStorage.setItem('zoya_docs', JSON.stringify(docDatabase));
    } catch (e) {
      console.error('Failed to save docDatabase to localStorage:', e);
    }
  }, [docDatabase]);

  useEffect(() => {
    try {
      localStorage.setItem('zoya_task', JSON.stringify(currentTask));
    } catch (e) {
      console.error('Failed to save currentTask to localStorage:', e);
    }
  }, [currentTask]);

  useEffect(() => {
    try {
      localStorage.setItem('zoya_formtype', JSON.stringify(activeFormType));
    } catch (e) {
      console.error('Failed to save activeFormType to localStorage:', e);
    }
  }, [activeFormType]);

  // Live PDF Synchronization
  useEffect(() => {
    const updatePreview = async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch('http://localhost:3000/api/preview-known-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formType: activeFormType, caseFile })
        });
        if (!res.ok) throw new Error("Preview failed");
        const blob = await res.blob();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
      } catch (err) { console.error("Preview sync error:", err); }
      finally { setPreviewLoading(false); }
    };
    updatePreview();
  }, [activeFormType]);

  // Handle data-driven updates separately with debounce
  useEffect(() => {
    const shouldUpdate = Object.values(caseFile).some(v => v !== null && v !== "Establishing...");
    if (!shouldUpdate) return;

    const updatePreview = async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch('http://localhost:3000/api/preview-known-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formType: activeFormType, caseFile })
        });
        const blob = await res.blob();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
      } catch (err) { console.error("Real-time preview update failed", err); }
      finally { setPreviewLoading(false); }
    };

    const timeout = setTimeout(updatePreview, 1500);
    return () => clearTimeout(timeout);
  }, [caseFile]);

  const handleAction = async (val) => {
    const textToSend = safelyStringify(val || input || "").trim();
    if (!textToSend) return;

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

      if (data.reply) {
        setMessages(prev => [...prev, { role: 'agent', text: safelyStringify(data.reply) }]);
      }

      setCurrentTask({
        type: safelyStringify(data.inputType || 'text'),
        label: safelyStringify(data.inputLabel || 'Provide details'),
        options: Array.isArray(data.options) ? data.options.map(safelyStringify) : [],
        formType: data.formType ? safelyStringify(data.formType) : null
      });

      if (data.extractedFacts) {
        setCaseFile(prev => {
          const freshFacts = {};
          for (let key in data.extractedFacts) {
            if (data.extractedFacts[key]) freshFacts[key] = safelyStringify(data.extractedFacts[key]);
          }
          return { ...prev, ...freshFacts };
        });
      }

      if (data.newDocRequirement) {
        setDocDatabase(prev => {
          const name = safelyStringify(data.newDocRequirement);
          if (prev.some(d => d.name === name)) return prev;
          return [...prev, { name, uploaded: false, formType: data.formType ? safelyStringify(data.formType) : null }];
        });
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'agent', text: 'Connection issue. Zoya is still here.' }]);
    } finally {
      setLoading(false);
    }
  };

  const markDocUploaded = (idx) => {
    if (idx < 0) return;
    setDocDatabase(prev => {
      if (!prev[idx]) return prev;
      const clone = [...prev];
      clone[idx].uploaded = true;
      return clone;
    });
  };

  const handleAutofillKnown = async (formType) => {
    if (!formType) return;
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/api/fill-known-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formType: safelyStringify(formType), caseFile })
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Zoya_Official_${safelyStringify(formType)}.pdf`;
      a.click();

      const docIdx = docDatabase.findIndex(d => d.formType === formType);
      if (docIdx !== -1) markDocUploaded(docIdx);

    } catch (err) { alert("Failed to autofill form."); }
    finally { setLoading(false); }
  };

  const handleFillGeneral = async (e) => {
    const file = e.target.files?.[0];
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

  const requiredDocs = (docDatabase || []).filter(d => !d.uploaded);
  const submittedDocs = (docDatabase || []).filter(d => d.uploaded);

  return (
    <div className="dashboard-container">

      {/* LEFT PANEL: DOC DATABASE */}
      <aside className="panel left-panel">
        <header className="panel-header">
          <h2>Doc Database</h2>
        </header>

        <div className="doc-list">
          <span className="task-label">Action Needed</span>
          {requiredDocs.length === 0 ? <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '1rem' }}>All identified docs submitted.</p> :
            requiredDocs.map((doc, idx) => {
              const originalIdx = docDatabase.findIndex(d => d.name === doc.name);
              return (
                <div key={`req-${idx}`} className="doc-item">
                  <div className="doc-name">{safelyStringify(doc.name)}</div>

                  {doc.formType ? (
                    <div className="mini-upload-btn" style={{ background: '#0d9488', color: 'white', border: 'none', textAlign: 'center', cursor: 'pointer' }} onClick={() => handleAutofillKnown(doc.formType)}>
                      Zoya Autofill Now
                    </div>
                  ) : (
                    <div className="mini-upload-btn-wrapper">
                      <div className="mini-upload-btn" style={{ textAlign: 'center' }}>Submit Document</div>
                      <input type="file" onChange={() => markDocUploaded(originalIdx)} />
                    </div>
                  )}
                </div>
              );
            })
          }

          {submittedDocs.length > 0 && <hr style={{ margin: '1.5rem 0', opacity: 0.1 }} />}

          <span className="task-label">Secure Repository</span>
          {submittedDocs.map((doc, idx) => (
            <div key={`sub-${idx}`} className="doc-item done">
              <div className="doc-name">{safelyStringify(doc.name)}</div>
              <span className="check-icon">✓ SECURED</span>
            </div>
          ))}

          <EmergencyShelters shelters={shelters} />
        </div>
      </aside>

      {/* MAIN: CHAT HISTORY */}
      <main className="panel chat-panel">
        <header className="panel-header" style={{ borderBottom: '2px solid rgba(139, 92, 246, 0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <h2 style={{ color: '#8b5cf6', fontSize: '1.2rem', margin: 0 }}>Zoya Advocate</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="status-indicator">End-to-End Encrypted</div>
              <button
                onClick={handleClearChat}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Clear Chat
              </button>
            </div>
          </div>
        </header>

        <div className="chat-messages">
          {(messages || []).map((m, i) => <div key={`msg-${i}`} className={`bubble ${m.role}`}>{safelyStringify(m.text)}</div>)}

          {!loading && currentTask && (
            <div className="bubble agent intake-bubble">
              <p style={{ marginBottom: '1rem', fontWeight: 800, color: '#8b5cf6', fontSize: '0.95rem' }}>{safelyStringify(currentTask.label)}</p>
              {currentTask.type === 'choice' ? (
                <div className="option-grid">
                  {(currentTask.options || []).map((opt, i) => (
                    <div key={`opt-${i}`} className="pill-btn" onClick={() => handleAction(opt)} role="button" style={{ textAlign: 'center' }}>
                      {safelyStringify(opt)}
                    </div>
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
                  <div className="send-btn" onClick={() => handleAction()} role="button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>OK</div>
                </div>
              )}

              {currentTask.formType && (
                <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0fdfa', borderRadius: '12px', border: '1px solid #ccfbf1' }}>
                  <p style={{ fontSize: '0.8rem', color: '#0d9488', fontWeight: 600, marginBottom: '0.5rem' }}>
                    ✨ Zoya has identified an official HK form for this.
                  </p>
                  <div className="primary-btn" style={{ background: '#0d9488', width: '100%', fontSize: '0.8rem', textAlign: 'center', cursor: 'pointer' }} onClick={() => handleAutofillKnown(currentTask.formType)}>
                    Autofill & Download Official PDF
                  </div>
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
            placeholder="Message Zoya..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAction()}
          />
          <div className="primary-btn" onClick={() => handleAction()} role="button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>Send</div>
        </div>
      </main>

      {/* RIGHT: LIVE PDF ARCHITECT */}
      <aside className="panel right-panel">
        <header className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
          <h2>Live PDF Architect</h2>
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
            <div
              className={`status-indicator ${activeFormType === 'cssa' ? 'active' : ''}`}
              onClick={() => setActiveFormType('cssa')}
              style={{ cursor: 'pointer', opacity: activeFormType === 'cssa' ? 1 : 0.5 }}
            >CSSA FORM</div>
            <div
              className={`status-indicator ${activeFormType === 'marriage_search' ? 'active' : ''}`}
              onClick={() => setActiveFormType('marriage_search')}
              style={{ cursor: 'pointer', opacity: activeFormType === 'marriage_search' ? 1 : 0.5 }}
            >MARRIAGE SEARCH</div>
          </div>
        </header>

        <div className="preview-container" style={{ flex: 1, position: 'relative', background: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>
          {previewLoading && (
            <div style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'white', padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, color: '#8b5cf6', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10 }}>
              Zoya is Drawing...
            </div>
          )}
          {previewUrl ? (
            <iframe
              src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0`}
              style={{ width: '100%', flex: 1, border: 'none', background: 'white' }}
              title="PDF Preview"
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📄</div>
              <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>Loading Zoya Architect...</p>
            </div>
          )}
        </div>

        <div style={{ padding: '1rem', background: 'white', borderTop: '1px solid var(--border)' }}>
          <div className="case-content" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
            <div className="case-card active" style={{ padding: '0.5rem' }}>
              <div className="card-header" style={{ fontSize: '0.6rem' }}>Identity</div>
              <div className="card-body" style={{ fontSize: '0.7rem' }}>{safelyStringify(caseFile.name || '...')}</div>
            </div>
            <div className="case-card active" style={{ padding: '0.5rem' }}>
              <div className="card-header" style={{ fontSize: '0.6rem' }}>Finance</div>
              <div className="card-body" style={{ fontSize: '0.7rem' }}>{safelyStringify(caseFile.financial || '...')}</div>
            </div>
          </div>
          <div className="mini-upload-btn-wrapper">
            <div className="primary-btn" style={{ width: '100%', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', fontSize: '0.75rem' }}>Map Any Template</div>
            <input type="file" onChange={handleFillGeneral} accept=".pdf,.docx" />
          </div>
        </div>
      </aside>

      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </div>
  );
}
