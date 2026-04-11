import React, { useState } from 'react';

const SECTIONS = [
  { title: '👤 About You', fields: [
    { key: 'name', label: 'Full Name' },
    { key: 'hkid', label: 'HKID Number' },
    { key: 'dob', label: 'Date of Birth' },
    { key: 'sex', label: 'Sex (M/F)' },
    { key: 'address', label: 'Address' },
    { key: 'phone', label: 'Phone Number' },
  ]},
  { title: '👨‍👩‍👧‍👦 Family', fields: [
    { key: 'marital_status', label: 'Marital Status' },
    { key: 'spouse_name', label: "Spouse's Name" },
    { key: 'spouse_hkid', label: "Spouse's HKID" },
    { key: 'marriage_date', label: 'Marriage Date' },
    { key: 'marriage_place', label: 'Marriage Place' },
    { key: 'children', label: 'Children (number & ages)' },
  ]},
  { title: '💰 Finances', fields: [
    { key: 'employment', label: 'Employment Status' },
    { key: 'income', label: 'Monthly Income (HK$)' },
    { key: 'savings', label: 'Savings / Assets' },
    { key: 'accommodation', label: 'Accommodation Type' },
    { key: 'rent', label: 'Monthly Rent (HK$)' },
  ]},
  { title: '🚨 Emergency Contact', fields: [
    { key: 'emergency_name', label: 'Trusted Person Name' },
    { key: 'emergency_phone', label: 'Their Phone Number' },
    { key: 'emergency_relation', label: 'Relationship' },
  ]},
  { title: '🚨 Emergency Contact', fields: [
    { key: 'emergency_name', label: 'Trusted Person Name' },
    { key: 'emergency_phone', label: 'Their Phone Number' },
    { key: 'emergency_relation', label: 'Relationship (sister, friend, etc.)' },
  ]},
];

export default function CaseProfile({ onBack }) {
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zoya_casefile')) || {}; } catch { return {}; }
  });
  const [saved, setSaved] = useState(false);

  const set = (key, val) => { setData(prev => ({ ...prev, [key]: val })); setSaved(false); };

  const save = () => {
    localStorage.setItem('zoya_casefile', JSON.stringify(data));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const allFields = SECTIONS.flatMap(s => s.fields);
  const filled = allFields.filter(f => data[f.key] && data[f.key] !== 'Establishing...').length;

  return (
    <div style={{height:'100vh', background:'#f8fafc', fontFamily:'Inter, sans-serif', overflowY:'auto'}}>
      <header style={{padding:'1rem 2rem', background:'white', borderBottom:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:10}}>
        <div>
          <h1 style={{margin:0, fontSize:'1.1rem', fontWeight:800, color:'#1e293b', fontFamily:'Outfit, sans-serif'}}>My Profile</h1>
          <p style={{margin:'0.2rem 0 0', fontSize:'0.7rem', color:'#64748b'}}>{filled}/{allFields.length} fields · This data auto-fills all your forms</p>
        </div>
        <div style={{display:'flex', gap:'0.6rem', alignItems:'center'}}>
          {saved && <span style={{fontSize:'0.8rem', color:'#10b981', fontWeight:600}}>✓ Saved</span>}
          <button onClick={save} style={{padding:'0.5rem 1.5rem', background:'#8b5cf6', color:'white', border:'none', borderRadius:'8px', fontWeight:700, cursor:'pointer'}}>Save</button>
          <button onClick={onBack} style={{padding:'0.5rem 1rem', background:'#f1f5f9', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:'8px', fontWeight:600, cursor:'pointer'}}>← Back</button>
        </div>
      </header>

      <div style={{maxWidth:'700px', margin:'1.5rem auto', padding:'0 1.5rem'}}>
        {SECTIONS.map(section => (
          <div key={section.title} style={{marginBottom:'1.5rem'}}>
            <h2 style={{fontSize:'0.9rem', fontWeight:700, color:'#1e293b', marginBottom:'0.6rem'}}>{section.title}</h2>
            <div style={{background:'white', borderRadius:'12px', border:'1px solid #e2e8f0', overflow:'hidden'}}>
              {section.fields.map((field, i) => (
                <div key={field.key} style={{display:'flex', alignItems:'center', padding:'0.7rem 1rem', borderBottom: i < section.fields.length - 1 ? '1px solid #f1f5f9' : 'none'}}>
                  <label style={{width:'160px', flexShrink:0, fontSize:'0.8rem', fontWeight:600, color: data[field.key] ? '#6d28d9' : '#94a3b8'}}>{field.label}</label>
                  <input
                    type="text"
                    value={data[field.key] || ''}
                    onChange={(e) => set(field.key, e.target.value)}
                    placeholder="—"
                    style={{flex:1, border:'none', outline:'none', fontSize:'0.85rem', color:'#1e293b', background:'transparent'}}
                  />
                  {data[field.key] && <span style={{color:'#10b981', fontSize:'0.7rem', fontWeight:700}}>✓</span>}
                </div>
              ))}
            </div>
          </div>
        ))}

        <p style={{fontSize:'0.7rem', color:'#94a3b8', textAlign:'center', marginTop:'2rem'}}>
          🔒 All data stays on your device. Zoya uses this to auto-fill CSSA, Legal Aid, Marriage Search, and other HK government forms.
        </p>
      </div>
    </div>
  );
}
