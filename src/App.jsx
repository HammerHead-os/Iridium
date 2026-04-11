import React, { useState, useEffect, useRef, useCallback } from 'react';
import ZenPlantDecoy from './components/ZenPlantDecoy';
import PathfinderDashboard from './components/PathfinderDashboard';
import CaseProfile from './components/CaseProfile';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';
import { useShelterData } from './hooks/useShelterData';
import { useNotification } from './hooks/useNotification';

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [page, setPage] = useState('main');
  const tapTimesRef = useRef([]);
  
  const { notification, triggerNotification } = useNotification();
  const shelters = useShelterData(triggerNotification);

  // Inactivity timeout — auto-lock after 60s
  useInactivityTimeout(60000, () => {
    if (unlocked) {
      try {
        const backup = {
          messages: localStorage.getItem('zoya_messages'),
          casefile: localStorage.getItem('zoya_casefile'),
          docs: localStorage.getItem('zoya_docs'),
          timestamp: Date.now()
        };
        localStorage.setItem('zoya_encrypted_backup', btoa(JSON.stringify(backup)));
      } catch(e) {}
      setUnlocked(false);
      setPage('main');
    }
  });

  // PANIC MODE: Triple-tap anywhere to instantly switch to decoy
  const handlePanicTap = useCallback(() => {
    const now = Date.now();
    tapTimesRef.current.push(now);
    tapTimesRef.current = tapTimesRef.current.slice(-3);
    
    if (tapTimesRef.current.length === 3) {
      const timeDiff = tapTimesRef.current[2] - tapTimesRef.current[0];
      if (timeDiff < 800 && unlocked) {
        setUnlocked(false);
        setPage('main');
        tapTimesRef.current = [];
      }
    }
  }, [unlocked]);

  // Keyboard panic: press Escape 3 times quickly
  const escTimesRef = useRef([]);
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && unlocked) {
        const now = Date.now();
        escTimesRef.current.push(now);
        escTimesRef.current = escTimesRef.current.slice(-3);
        if (escTimesRef.current.length === 3) {
          const diff = escTimesRef.current[2] - escTimesRef.current[0];
          if (diff < 1000) {
            setUnlocked(false);
            setPage('main');
            escTimesRef.current = [];
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [unlocked]);

  return (
    <div onClick={handlePanicTap}>
      {!unlocked ? (
        <ZenPlantDecoy onUnlock={() => setUnlocked(true)} notification={notification} />
      ) : page === 'profile' ? (
        <CaseProfile onBack={() => setPage('main')} />
      ) : (
        <PathfinderDashboard 
          onOpenProfile={() => setPage('profile')}
          onLock={() => { setUnlocked(false); setPage('main'); }} 
          shelters={shelters}
        />
      )}
    </div>
  );
}

export default App;
