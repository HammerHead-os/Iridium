import React, { useState, useEffect, useRef, useCallback } from 'react';

const PLANTS = ['🌱', '🌿', '🌷', '🌻', '🌸', '🌺', '🪻', '🌹', '🌼', '🍀'];
const BIRDS = ['🐦', '🦅', '🐤', '🦜'];

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); return Math.round(255 * c).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b); let h, s, l = (max+min)/2;
  if (max===min) { h=s=0; } else { const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){ case r:h=((g-b)/d+(g<b?6:0))*60;break; case g:h=((b-r)/d+2)*60;break; default:h=((r-g)/d+4)*60; } }
  return [Math.round(h), Math.round(s*100), Math.round(l*100)];
}
function colorDistance(a, b) {
  const [h1,s1,l1]=hexToHsl(a),[h2,s2,l2]=hexToHsl(b);
  const hd=Math.min(Math.abs(h1-h2),360-Math.abs(h1-h2))/180;
  return Math.sqrt(hd*hd+((s1-s2)/100)**2+((l1-l2)/100)**2);
}

export default function ZenPlantDecoy({ onUnlock, notification }) {
  const [gameState, setGameState] = useState('menu');
  const [highScore, setHighScore] = useState(()=>{ try{return JSON.parse(localStorage.getItem('zen_hs'))||0}catch{return 0}});
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(15);
  const [targetColor, setTargetColor] = useState('#4ade80');
  const [playerHue, setPlayerHue] = useState(120);
  const [playerColor, setPlayerColor] = useState('#4ade80');
  const [plant, setPlant] = useState('🌱');
  const [bird, setBird] = useState('🐦');
  const [streak, setStreak] = useState(0);
  const [round, setRound] = useState(0);
  const [shake, setShake] = useState(false);
  const [matched, setMatched] = useState(false);
  const [difficulty, setDifficulty] = useState(0.35);
  const [danceBeat, setDanceBeat] = useState(0);
  // Snatch: 0=none, 1=bird flying in, 2=bird at plant, 3=bird leaving with plant
  const [snatch, setSnatch] = useState(0);
  const timerRef = useRef(null);

  // Hidden unlock
  useEffect(() => {
    let typed = '';
    const kd = e => { if(e.key.length>1)return; typed+=e.key.toLowerCase(); if(typed.length>4)typed=typed.slice(-4); if(typed==='safe')onUnlock(); };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [onUnlock]);

  const newRound = useCallback(() => {
    const h=Math.floor(Math.random()*360), s=50+Math.floor(Math.random()*40), l=40+Math.floor(Math.random()*30);
    setTargetColor(hslToHex(h,s,l)); setPlayerHue(Math.floor(Math.random()*360));
    setPlant(PLANTS[Math.floor(Math.random()*PLANTS.length)]); setBird(BIRDS[Math.floor(Math.random()*BIRDS.length)]);
    setTimeLeft(15); setSnatch(0); setShake(false); setMatched(false); setRound(r=>r+1);
  }, []);

  const startGame = () => { setGameState('playing'); setScore(0); setStreak(0); setDifficulty(0.35); newRound(); };
  const pauseGame = () => { clearInterval(timerRef.current); setGameState('paused'); };
  const resumeGame = () => setGameState('playing');
  const quitGame = () => { clearInterval(timerRef.current); if(score>highScore){setHighScore(score);localStorage.setItem('zen_hs',JSON.stringify(score));} setGameState('menu'); };

  useEffect(() => { const [,s,l]=hexToHsl(targetColor); setPlayerColor(hslToHex(playerHue,s,l)); }, [playerHue, targetColor]);

  // Countdown
  useEffect(() => {
    if (gameState !== 'playing') return;
    timerRef.current = setInterval(() => setTimeLeft(p => { if(p<=1){clearInterval(timerRef.current);return 0;} return p-1; }), 1000);
    return () => clearInterval(timerRef.current);
  }, [gameState, round]);

  // When time hits 0
  useEffect(() => {
    if (timeLeft > 0 || gameState !== 'playing') return;
    setGameState('snatching');
    setSnatch(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { setSnatch(1); });
    });
    const t1 = setTimeout(() => { setSnatch(2); setShake(true); }, 1600);
    const t2 = setTimeout(() => { setSnatch(3); setShake(false); }, 3000);
    const t3 = setTimeout(() => {
      if(score>highScore){setHighScore(score);localStorage.setItem('zen_hs',JSON.stringify(score));}
      setGameState('snatched');
    }, 4800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [timeLeft, gameState]);

  // Pause dance
  useEffect(() => { if(gameState!=='paused')return; const i=setInterval(()=>setDanceBeat(b=>b+1),400); return()=>clearInterval(i); }, [gameState]);

  const submitColor = () => {
    if (gameState !== 'playing') return;
    if (colorDistance(playerColor, targetColor) < difficulty) {
      clearInterval(timerRef.current); setMatched(true);
      const pts = 10 + Math.max(1, Math.floor(timeLeft/3)) + streak*2;
      setScore(p=>p+pts); setStreak(p=>p+1); setDifficulty(p=>Math.max(0.15,p-0.02));
      setTimeout(()=>newRound(), 800);
    } else { setShake(true); setTimeout(()=>setShake(false), 300); }
  };

  const wheelColors = Array.from({length:36},(_,i)=>hslToHex(i*10,70,55));

  // Render notification if present
  const renderNotification = () => notification && (
    <div className="decoy-notification">
      {notification}
    </div>
  );

  // ===== MENU =====
  if (gameState === 'menu') return (
    <div style={{minHeight:'100vh',background:'linear-gradient(180deg,#ecfdf5,#d1fae5)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:'Inter,sans-serif',position:'relative'}}>
      {renderNotification()}
      <div style={{fontSize:'5rem',marginBottom:'0.5rem',animation:'float 3s ease-in-out infinite'}}>🌱</div>
      <h1 style={{fontSize:'2.2rem',fontWeight:800,color:'#166534',margin:'0 0 0.3rem',fontFamily:'Outfit,sans-serif'}}>Bloom Guard</h1>
      <p style={{color:'#16a34a',fontSize:'0.9rem',marginBottom:'2.5rem',textAlign:'center',maxWidth:'280px',lineHeight:1.6}}>Match the plant color to the background<br/>before the bird snatches it!</p>
      <button onClick={startGame} style={{padding:'1rem 3.5rem',borderRadius:'50px',border:'none',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'white',fontWeight:800,fontSize:'1.1rem',cursor:'pointer',boxShadow:'0 8px 25px rgba(34,197,94,0.4)'}}>Start Game</button>
      {highScore > 0 && <p style={{marginTop:'1.5rem',color:'#ca8a04',fontWeight:700}}>🏆 Best: {highScore}</p>}
      <p style={{marginTop:'3rem',fontSize:'0.7rem',color:'#94a3b8'}}>Bloom Guard v3.0</p>
    </div>
  );

  // PAUSED, SNATCHED, PLAYING... (omitted for brevity in this scratch but should be full in reality)
  // I will write the full file content.
  
  const timerPct = (timeLeft/15)*100;
  const timerColor = timeLeft>8?'#22c55e':timeLeft>4?'#f59e0b':'#ef4444';
  const isSnatching = gameState === 'snatching';

  const birdPositions = { 0: { left: '110%', top: '5%' }, 1: { left: '42%', top: '25%' }, 2: { left: '42%', top: '28%' }, 3: { left: '110%', top: '-15%' } };
  const bp = birdPositions[snatch] || birdPositions[0];
  const birdStyle = {
    position: 'absolute', fontSize: '6rem', zIndex: 50, left: bp.left, top: bp.top, filter: 'drop-shadow(0 10px 25px rgba(0,0,0,0.3))', pointerEvents: 'none',
    transition: snatch === 1 ? 'left 1.4s cubic-bezier(0.25,0.1,0.25,1), top 1.4s cubic-bezier(0.25,0.1,0.25,1)' 
              : snatch === 2 ? 'left 0.3s ease, top 0.3s ease, transform 0.3s ease' 
              : snatch === 3 ? 'left 1.5s cubic-bezier(0.5,0,1,0.5), top 1.5s cubic-bezier(0.5,0,1,0.5)' : 'none',
    transform: snatch === 2 ? 'scaleX(-1) rotate(-10deg)' : snatch === 3 ? 'scaleX(1)' : 'scaleX(-1)',
  };

  if (gameState === 'paused') {
    const flowers = ['🌸','🌺','🌻','🌷','🌹','🪻'];
    const f = flowers[danceBeat % flowers.length];
    return (
      <div style={{minHeight:'100vh',background:'linear-gradient(180deg,#fdf4ff,#f5f3ff)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:'Inter,sans-serif',gap:'1.5rem',position:'relative'}}>
        {renderNotification()}
        <div style={{fontSize:'8rem',transform:`rotate(${danceBeat%2===0?-20:20}deg) translateY(${[0,-25,-5][danceBeat%3]}px)`,transition:'transform 0.3s ease'}}>{f}</div>
        <h2 style={{fontSize:'1.5rem',fontWeight:800,color:'#7c3aed',margin:0,fontFamily:'Outfit,sans-serif'}}>Paused</h2>
        <div style={{display:'flex',gap:'1rem'}}>
          <button onClick={resumeGame} style={{padding:'0.8rem 2.5rem',borderRadius:'50px',border:'none',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'white',fontWeight:800,fontSize:'1rem',cursor:'pointer'}}>▶ Resume</button>
          <button onClick={quitGame} style={{padding:'0.8rem 2rem',borderRadius:'50px',border:'2px solid #e2e8f0',background:'white',color:'#64748b',fontWeight:700,cursor:'pointer'}}>Quit</button>
        </div>
      </div>
    );
  }

  if (gameState === 'snatched') return (
    <div style={{minHeight:'100vh',background:'linear-gradient(180deg,#fef2f2,#fee2e2)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:'Inter,sans-serif',position:'relative'}}>
      {renderNotification()}
      <div style={{fontSize:'5rem',marginBottom:'0.5rem',animation:'bounce 0.8s infinite'}}>🐦</div>
      <h2 style={{fontSize:'1.8rem',fontWeight:800,color:'#991b1b',margin:'0 0 0.5rem',fontFamily:'Outfit,sans-serif'}}>Snatched!</h2>
      <div style={{display:'flex',gap:'2.5rem',margin:'0.5rem 0 2rem'}}>
        <div style={{textAlign:'center'}}><div style={{fontSize:'2.2rem',fontWeight:800,color:'#1e293b'}}>{score}</div><div style={{fontSize:'0.75rem',color:'#64748b'}}>Score</div></div>
      </div>
      <button onClick={startGame} style={{padding:'1rem 3rem',borderRadius:'50px',border:'none',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'white',fontWeight:800,fontSize:'1rem',cursor:'pointer',boxShadow:'0 8px 25px rgba(34,197,94,0.4)',marginBottom:'0.8rem'}}>Try Again</button>
      <button onClick={()=>setGameState('menu')} style={{padding:'0.7rem 2rem',borderRadius:'50px',border:'2px solid #e2e8f0',background:'white',color:'#64748b',fontWeight:600,cursor:'pointer'}}>Menu</button>
    </div>
  );

  return (
    <div style={{minHeight:'100vh',background:targetColor,display:'flex',flexDirection:'column',alignItems:'center',fontFamily:'Inter,sans-serif',transition:'background 0.8s',position:'relative',overflow:'visible'}}>
      {renderNotification()}
      <div style={{width:'100%',padding:'1.2rem 1.5rem',display:'flex',justifyContent:'space-between',alignItems:'center',zIndex:20}}>
        <div style={{display:'flex',gap:'0.6rem'}}>
          <div style={{background:'rgba(255,255,255,0.92)',padding:'0.4rem 1rem',borderRadius:'20px',fontWeight:800,fontSize:'0.9rem'}}>🌟 {score}</div>
          {streak>1 && <div style={{background:'rgba(255,255,255,0.92)',padding:'0.4rem 0.8rem',borderRadius:'20px',fontWeight:700,fontSize:'0.8rem',color:'#ca8a04'}}>🔥 x{streak}</div>}
        </div>
        <div style={{display:'flex',gap:'0.5rem'}}>
          <div style={{background:'rgba(255,255,255,0.92)',padding:'0.4rem 1rem',borderRadius:'20px',fontWeight:800,fontSize:'0.9rem',color:timerColor}}>{timeLeft}s</div>
          {!isSnatching && <button onClick={pauseGame} style={{background:'rgba(255,255,255,0.92)',border:'none',borderRadius:'50%',width:'36px',height:'36px',cursor:'pointer'}}>⏸</button>}
        </div>
      </div>
      <div style={{width:'85%',height:'6px',background:'rgba(255,255,255,0.25)',borderRadius:'3px',overflow:'hidden',marginBottom:'2rem'}}>
        <div style={{height:'100%',width:`${timerPct}%`,background:timerColor,transition:'width 1s linear'}} />
      </div>

      {isSnatching && <div style={birdStyle}>{bird}{snatch===3 && <span style={{position:'absolute',bottom:'-10px',left:'25px',fontSize:'3.5rem'}}>{plant}</span>}</div>}

      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'0.8rem',zIndex:10}}>
        <div style={{width:'200px',height:'200px',borderRadius:'50%',background:playerColor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'6rem',boxShadow:'0 12px 50px rgba(0,0,0,0.25)',border:'5px solid rgba(255,255,255,0.35)',animation: shake ? 'shake 0.3s' : matched ? 'pulse 0.5s' : (!isSnatching ? 'float 3s ease-in-out infinite' : (snatch===2 ? 'shake 0.3s infinite' : 'none')), transition:'opacity 0.5s, transform 0.5s, background 0.15s', opacity: snatch===3 ? 0 : 1, transform: snatch===3 ? 'scale(0.3) translateY(-100px)' : 'scale(1)'}}>
          {matched ? '✨' : plant}
        </div>
        {matched && <div style={{color:'white',fontWeight:800,fontSize:'1.3rem',textShadow:'0 2px 10px rgba(0,0,0,0.3)'}}>Match!</div>}
      </div>

      {!isSnatching && (
        <div style={{width:'100%',padding:'0 2rem 2rem',maxWidth:'420px'}}>
          <div style={{display:'flex',height:'44px',borderRadius:'22px',overflow:'hidden',boxShadow:'0 4px 20px rgba(0,0,0,0.15)',cursor:'pointer',border:'3px solid rgba(255,255,255,0.4)',marginBottom:'1rem'}} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setPlayerHue(Math.round(((e.clientX-r.left)/r.width)*360));}}>
            {wheelColors.map((c,i)=>(<div key={i} style={{flex:1,background:c,position:'relative'}}>{Math.abs(playerHue-i*10)<5 && <div style={{position:'absolute',inset:'-4px 0',border:'3px solid white',borderRadius:'4px'}} />}</div>))}
          </div>
          <button onClick={submitColor} style={{width:'100%',padding:'1rem',borderRadius:'50px',border:'none',background:'white',fontWeight:800,fontSize:'1.05rem',cursor:'pointer'}}>Lock Color</button>
        </div>
      )}
    </div>
  );
}
