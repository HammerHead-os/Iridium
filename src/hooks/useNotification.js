import { useState, useEffect } from 'react';

export function useNotification() {
    const [notification, setNotification] = useState(null);

    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => {
                setNotification(null);
            }, 5000); // Notification disappears after 5 seconds
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const triggerNotification = (message) => {
        setNotification(message);
    };

    return { notification, triggerNotification };
}
