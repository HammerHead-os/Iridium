import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';

const initialShelters = [
	{ name: 'Serene Court', waitlist: 10, status: 'waitlist', phone: '2381 3311' },
	{ name: 'Harmony House', waitlist: 2, status: 'waitlist', phone: '2522 0434' },
	{ name: 'The Family Crisis Support Centre', waitlist: 0, status: 'too_far', phone: '18288' },
	{ name: 'CEASE Crisis Centre', waitlist: 3, status: 'waitlist', phone: '18281' },
	{ name: 'Sunrise Court', waitlist: 12, status: 'waitlist', phone: '8100 1155' },
];

const sortShelters = (sheltersToSort) => {
	const available = sheltersToSort.filter(s => s.status === "available");
	const waitlisted = sheltersToSort.filter(s => s.status === "waitlist").sort((a, b) => a.waitlist - b.waitlist);
	const distant = sheltersToSort.filter(s => s.status === "too_far");

	return [...available, ...waitlisted, ...distant];
};

export function useShelterData(triggerNotification) {
	const [shelters, setShelters] = useState(() => sortShelters(initialShelters));

	useEffect(() => {
		const timer = setInterval(() => {
			setShelters(prevShelters => {
				const harmonyHouse = prevShelters.find(s => s.name === 'Harmony House');

				if (!harmonyHouse || harmonyHouse.status !== 'waitlist' || harmonyHouse.waitlist <= 0) {
					return prevShelters;
				}

				const updatedShelters = prevShelters.map(shelter => {
					if (shelter.name === 'Harmony House') {
						const newWaitlist = shelter.waitlist - 1;

						if (newWaitlist === 0) {
							// This will show the toast notification on the dashboard
							toast.success(`${shelter.name} is now available!`, {
								toastId: 'harmony-house-available'
							});
							// This will trigger the notification for the decoy screen
							triggerNotification("Your plant has bloomed");
						}

						return {
							...shelter,
							waitlist: newWaitlist,
							status: newWaitlist > 0 ? 'waitlist' : 'available',
						};
					}
					return shelter;
				});

				return sortShelters(updatedShelters);
			});
		}, 5000);

		return () => clearInterval(timer);
	}, [triggerNotification]);

	return shelters;
}
