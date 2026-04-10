import React, { useState, useEffect } from 'react';

export default function ZenPlantDecoy({ onUnlock }) {
  const [waterLevel, setWaterLevel] = useState(0);
  
  // Hidden keylogger for the unlock password: "safe"
  useEffect(() => {
    let typed = '';
    const handleKeyDown = (e) => {
      if (e.key.length > 1) return;
      typed += e.key.toLowerCase();
      if (typed.length > 4) typed = typed.slice(-4);
      if (typed === 'safe') {
        onUnlock();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUnlock]);

  const handleWater = () => {
    setWaterLevel((prev) => (prev < 100 ? prev + 20 : 100));
  };

  return (
    <div className="zen-container">
      <div className="zen-header">
        <h1>Zoya</h1>
        <p>Mindfully grow, peacefully breathe.</p>
      </div>
      
      <div className="plant-area">
        <div className="pot"></div>
        <div className="stem" style={{ height: `${60 + (waterLevel * 1.5)}px` }}></div>
        <div className={`leaf left-leaf ${waterLevel >= 20 ? 'grown' : ''}`}></div>
        <div className={`leaf right-leaf ${waterLevel >= 40 ? 'grown' : ''}`}></div>
        <div className={`leaf left-leaf ${waterLevel >= 60 ? 'grown' : ''}`} style={{bottom: '180px'}}></div>
        <div className={`leaf right-leaf ${waterLevel >= 80 ? 'grown' : ''}`} style={{bottom: '220px'}}></div>
      </div>

      <button className="water-btn" onClick={handleWater}>
        Nurture Plant
      </button>

      <div style={{marginTop: '3rem', fontSize: '0.8rem', color: '#94a3b8'}}>
         Version 2.2 — Life (Affirming Survival)
      </div>
    </div>
  );
}
