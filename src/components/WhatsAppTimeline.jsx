import React, { useState, useEffect } from 'react';
import { extractTimeline } from '../api';

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ABUSE_COLORS = {
  physical: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', label: '🔴 Physical' },
  emotional: { bg: '#fefce8', border: '#fde047', text: '#854d0e', label: '🟡 Emotional' },
  financial: { bg: '#fff7ed', border: '#fdba74', text: '#9a3412', label: '🟠 Financial' },
  coercive_control: { bg: '#fdf4ff', border: '#e879f9', text: '#86198f', label: '🟣 Coercive Control' },
  sexual: { bg: '#fef2f2', border: '#f87171', text: '#7f1d1d', label: '🔴 Sexual' },
  threats: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', label: '⚠️ Threats' },
  default: { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569', label: '⬜ Other' },
};

export default function WhatsAppTimeline() {
  const [rawText, setRawText] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [error, setError] = useState(null);
  const [uploadedName, setUploadedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('whatsapp_timeline');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setTimeline(data.timeline || []);
        setLanguage(data.language || '');
        setUploadedName(data.uploadedName || '');
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (timeline.length > 0) {
      localStorage.setItem('whatsapp_timeline', JSON.stringify({ timeline, language, uploadedName, savedAt: new Date().toISOString() }));
    }
  }, [timeline, language, uploadedName]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    setUploadedName(file.name);
    setTimeline([]);
    setError(null);
  };

  const handleClearAll = () => {
    setRawText(''); setTimeline([]); setError(null); setUploadedName(''); setLanguage('');
    localStorage.removeItem('whatsapp_timeline');
  };

  const handleParseClick = async () => {
    if (!rawText.trim()) { setError('Please paste or upload a conversation text before parsing.'); return; }
    try {
      setBusy(true); setError(null);
      const data = await extractTimeline(rawText);
      setTimeline(data.timeline || []);
      setLanguage(data.language || 'unknown');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse the text.');
    } finally { setBusy(false); }
  };

  // Detect escalation patterns
  const getEscalationAnalysis = () => {
    if (timeline.length < 2) return null;
    const sorted = [...timeline].sort((a, b) => new Date(a.date) - new Date(b.date));
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));
    
    const avgGapFirst = firstHalf.length > 1 ? (new Date(firstHalf[firstHalf.length-1].date) - new Date(firstHalf[0].date)) / firstHalf.length : 0;
    const avgGapSecond = secondHalf.length > 1 ? (new Date(secondHalf[secondHalf.length-1].date) - new Date(secondHalf[0].date)) / secondHalf.length : 0;
    
    if (avgGapSecond > 0 && avgGapFirst > 0 && avgGapSecond < avgGapFirst * 0.7) {
      return { escalating: true, message: 'Incidents are becoming more frequent over time — this is an escalation pattern.' };
    }
    return { escalating: false, message: 'No clear escalation pattern detected in frequency.' };
  };

  // Generate court-ready chronology PDF (text format)
  const handleDownloadCourtReport = () => {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('         INCIDENT CHRONOLOGY — PREPARED FOR LEGAL REVIEW');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(`Prepared: ${new Date().toLocaleString('en-GB')}`);
    lines.push(`Total Documented Incidents: ${timeline.length}`);
    lines.push(`Language Detected: ${language}`);
    
    const escalation = getEscalationAnalysis();
    if (escalation) lines.push(`Escalation Assessment: ${escalation.message}`);
    
    // Abuse type summary
    const typeCounts = {};
    timeline.forEach(e => {
      const types = e.abuse_types || e.keywords || [];
      types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
    });
    lines.push('');
    lines.push('ABUSE TYPE SUMMARY:');
    Object.entries(typeCounts).sort((a,b) => b[1]-a[1]).forEach(([type, count]) => {
      lines.push(`  • ${type}: ${count} incident(s)`);
    });
    
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('                    DETAILED INCIDENT LOG');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');

    const sorted = [...timeline].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((entry, i) => {
      lines.push(`INCIDENT ${i + 1} — ${entry.date}`);
      lines.push(`Summary: ${entry.summary}`);
      if (entry.abuse_types?.length) lines.push(`Classification: ${entry.abuse_types.join(', ')}`);
      if (entry.keywords?.length) lines.push(`Key Indicators: ${entry.keywords.join(', ')}`);
      if (entry.quotes?.length) {
        lines.push('Direct Evidence:');
        entry.quotes.forEach(q => lines.push(`  > "${q}"`));
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('DISCLAIMER: This chronology is a documentation aid generated');
    lines.push('from chat records. It is not legal advice. All quotes are');
    lines.push('extracted verbatim from the source conversation.');
    lines.push('Consult qualified DV services for formal legal guidance.');
    lines.push('═══════════════════════════════════════════════════════════════');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Court_Chronology_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const escalation = getEscalationAnalysis();

  return (
    <section style={{maxWidth:'1000px', margin:'0 auto', padding:'1rem', fontFamily:'Inter, sans-serif'}}>
      <div style={{marginBottom:'1.5rem', textAlign:'center'}}>
        <h2 style={{color:'var(--primary-dark)', marginBottom:'0.4rem', fontSize: '1.4rem', fontFamily: 'Outfit, sans-serif'}}>Evidence Vault</h2>
        <p style={{color:'var(--text-muted)', fontSize:'0.9rem'}}>Auto-generate a court-ready chronology from chat exports</p>
      </div>

      <div style={{display:'flex', gap:'0.8rem', marginBottom:'1.5rem', flexWrap:'wrap', justifyContent:'center'}}>
        <label style={{padding:'0.6rem 1.2rem', backgroundColor:'var(--primary)', color:'white', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize: '0.9rem', border:'none'}}>
          📁 Select File
          <input type="file" accept=".txt,text/plain" onChange={handleFileChange} style={{display:'none'}} />
        </label>
        <button onClick={handleParseClick} disabled={!rawText.trim() || busy} style={{padding:'0.6rem 1.2rem', backgroundColor: busy ? '#cbd5e1' : 'var(--accent)', color:'white', border:'none', borderRadius:'8px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight:'700', fontSize:'0.9rem'}}>
          {busy ? '⏳ Analyzing...' : '📊 Generate Chronology'}
        </button>
      </div>

      <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Paste text here..." style={{width:'100%', height:'180px', padding:'1rem', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', fontFamily:'monospace', fontSize:'0.9rem', marginBottom:'1rem', resize:'vertical', background: '#fff'}} />

      {uploadedName && <div style={{padding:'0.6rem 1rem', backgroundColor:'var(--accent-light)', color:'var(--accent)', borderRadius:'var(--radius-sm)', marginBottom:'1rem', fontSize:'0.85rem', fontWeight: 600}}>✓ Loaded: {uploadedName}</div>}

      {timeline.length > 0 && (
        <div style={{animation: 'none'}}>
          {/* Summary Panel */}
          <div style={{padding:'1.5rem', backgroundColor:'var(--beige)', borderRadius:'var(--radius-md)', marginBottom:'1.5rem', border:'1px solid var(--border)'}}>
            <h3 style={{color:'var(--primary-dark)', marginTop:0, marginBottom:'1rem', fontFamily: 'Outfit, sans-serif', fontSize: '1.1rem'}}>Analysis Summary</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem', marginBottom:'1.2rem'}}>
              <div style={{background:'white', padding:'1rem', borderRadius:'var(--radius-sm)', textAlign:'center', border: '1px solid var(--border)'}}>
                <div style={{fontSize:'1.4rem', fontWeight:800, color:'var(--primary)'}}>{timeline.length}</div>
                <div style={{fontSize:'0.7rem', color:'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase'}}>Incidents</div>
              </div>
              <div style={{background:'white', padding:'1rem', borderRadius:'var(--radius-sm)', textAlign:'center', border: '1px solid var(--border)'}}>
                <div style={{fontSize:'1.4rem', fontWeight:800, color:'var(--primary)'}}>{new Set(timeline.flatMap(e => e.abuse_types || e.keywords || [])).size}</div>
                <div style={{fontSize:'0.7rem', color:'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase'}}>Indicators</div>
              </div>
              <div style={{background:'white', padding:'1rem', borderRadius:'var(--radius-sm)', textAlign:'center', border: '1px solid var(--border)'}}>
                <div style={{fontSize:'1.4rem', fontWeight:800, color: escalation?.escalating ? '#dc2626' : 'var(--accent)'}}>{escalation?.escalating ? '⚠️' : '✅'}</div>
                <div style={{fontSize:'0.7rem', color:'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase'}}>Status</div>
              </div>
            </div>
            
            <div style={{display:'flex', gap:'0.8rem', flexWrap:'wrap'}}>
              <button onClick={handleDownloadCourtReport} style={{padding:'0.6rem 1.2rem', backgroundColor:'var(--primary-dark)', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize: '0.85rem'}}>
                📥 Export Chronology
              </button>
              <button onClick={handleClearAll} style={{padding:'0.6rem 1.2rem', backgroundColor:'transparent', color:'#ef4444', border:'1px solid #fee2e2', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize: '0.85rem'}}>
                🗑️ Clear
              </button>
            </div>
          </div>

          {/* Timeline Cards */}
          <div style={{display:'flex', flexDirection:'column', gap:'1rem'}}>
            {[...timeline].sort((a, b) => new Date(a.date) - new Date(b.date)).map((entry, index) => {
              const types = entry.abuse_types || [];
              const primaryType = types[0] || 'default';
              const colors = ABUSE_COLORS[primaryType] || ABUSE_COLORS.default;
              
              return (
                <article key={index} style={{
                  padding:'1.2rem', 
                  backgroundColor:'white', 
                  borderRadius:'var(--radius-md)', 
                  border:`1px solid var(--border)`, 
                  borderLeft:`6px solid ${colors.border}`,
                  transition: 'none'
                }}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.8rem', paddingBottom:'0.6rem', borderBottom:'1px solid var(--bg-main)'}}>
                    <strong style={{fontSize:'0.95rem', color:'var(--text-main)', fontFamily: 'Outfit, sans-serif'}}>{formatDate(entry.date)}</strong>
                    <div style={{display:'flex', gap:'0.4rem'}}>
                      {types.map((type, i) => {
                        const c = ABUSE_COLORS[type] || ABUSE_COLORS.default;
                        return <span key={i} style={{padding:'0.2rem 0.6rem', background:c.bg, color:c.text, borderRadius:'4px', fontSize:'0.65rem', fontWeight:800, border:`1px solid ${c.border}`, textTransform: 'uppercase'}}>{c.label}</span>;
                      })}
                    </div>
                  </div>
                  <p style={{margin:'0.6rem 0', color:'var(--text-main)', lineHeight:1.5, fontSize: '0.9rem'}}>{entry.summary}</p>
                  {entry.keywords?.length > 0 && (
                    <div style={{marginTop:'0.6rem'}}>
                      <div style={{display:'flex', gap: '0.4rem', flexWrap: 'wrap'}}>
                        {entry.keywords.map((kw, i) => (
                          <span key={i} style={{padding:'0.2rem 0.5rem', backgroundColor:'#fef9c3', color:'#854d0e', borderRadius:'4px', fontSize:'0.75rem', fontWeight:'600', border: '1px solid #fde047'}}>{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {entry.quotes?.length > 0 && (
                    <div style={{marginTop:'1rem', paddingTop:'0.8rem', borderTop:'1px solid var(--bg-main)'}}>
                      {entry.quotes.map((quote, i) => (
                        <blockquote key={i} style={{margin:'0 0 0.6rem 0', padding:'0.8rem', borderLeft:'4px solid #ef4444', color:'#7f1d1d', fontSize:'0.85rem', fontStyle:'italic', backgroundColor:'#fff1f2', borderRadius:'4px'}}>
                          "{quote}"
                        </blockquote>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      <div style={{marginTop:'2rem', padding:'1rem', fontSize:'0.85rem', color:'var(--text-muted)', textAlign: 'center', borderTop: '1px solid var(--border)'}}>
        🛡️ Encrypted Analysis • ⚖️ Documentation Aid
      </div>
    </section>
  );
}
