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
		const harmonyHouse = shelters.find(s => s.name === 'Harmony House');
		if (harmonyHouse && harmonyHouse.status === 'available' && harmonyHouse.waitlist === 0) {
			// Trigger only once
			if (!window._harmonyHouseNotified) {
				toast.success(`${harmonyHouse.name} is now available!`, {
					toastId: 'harmony-house-available'
				});
				triggerNotification("Your plant has bloomed");
				window._harmonyHouseNotified = true;
			}
		}
	}, [shelters, triggerNotification]);

	useEffect(() => {
		const timer = setInterval(() => {
			setShelters(prevShelters => {
				const harmonyHouse = prevShelters.find(s => s.name === 'Harmony House');
				if (!harmonyHouse || harmonyHouse.status !== 'waitlist' || harmonyHouse.waitlist <= 0) {
					return prevShelters;
				}

				const updatedShelters = prevShelters.map(shelter => {
					if (shelter.name === 'Harmony House') {
						const newWaitlist = Math.max(0, shelter.waitlist - 1);
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
	}, []);

	return shelters;
}
