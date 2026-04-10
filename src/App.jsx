import React, { useState } from 'react';
import ZenPlantDecoy from './components/ZenPlantDecoy';
import PathfinderDashboard from './components/PathfinderDashboard';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';
import { useShelterData } from './hooks/useShelterData';
import { useNotification } from './hooks/useNotification';

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const { notification, triggerNotification } = useNotification();
  const shelters = useShelterData(triggerNotification);

  useInactivityTimeout(60000, () => {
    if (unlocked) {
      setUnlocked(false);
      window.location.reload();
    }
  });

  return (
    <>
      {!unlocked ? (
        <ZenPlantDecoy onUnlock={() => setUnlocked(true)} notification={notification} />
      ) : (
        <PathfinderDashboard shelters={shelters} />
      )}
    </>
  );
}

export default App;
