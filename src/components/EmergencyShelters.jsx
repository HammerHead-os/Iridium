import React from 'react';

export default function EmergencyShelters({ shelters }) {
	return (
		<>
			<hr style={{ margin: '1.5rem 0', opacity: 0.1 }} />
			<span className="task-label">Emergency Shelters</span>
			{shelters.map((shelter, idx) => (
				<div key={`shelter-${idx}`} className="doc-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div>
						<div className="doc-name">{shelter.name}</div>
						<div className="doc-phone" style={{ fontSize: '0.75rem', color: '#64748b' }}>{shelter.phone}</div>
					</div>
					{shelter.status === 'available' && (
						<div className="mini-upload-btn" style={{
							background: '#0d9488', color: 'white', border: 'none', textAlign: 'center', cursor: 'pointer', padding: '0.25rem 0.6rem', fontSize: '0.7rem', borderRadius: '6px', fontWeight: 500, display: 'inline-block',
							boxSizing: 'border-box',
							minWidth: '85px',
							maxWidth: '85px',
						}}>
							Apply Now
						</div>
					)}
					{shelter.status === 'waitlist' && (
						<div className="mini-upload-btn" style={{
							background: '#f97316', color: 'white', border: 'none', textAlign: 'center', cursor: 'default', padding: '0.25rem 0.6rem', fontSize: '0.7rem', borderRadius: '6px', fontWeight: 500, display: 'inline-block',
							boxSizing: 'border-box',
							minWidth: '85px',
							maxWidth: '85px',
						}}>
							Waitlist: {shelter.waitlist}
						</div>
					)}
					{shelter.status === 'too_far' && (
						<div className="mini-upload-btn" style={{
							background: '#64748b', color: 'white', border: 'none', textAlign: 'center', cursor: 'default', padding: '0.25rem 0.6rem', fontSize: '0.7rem', borderRadius: '6px', fontWeight: 500, display: 'inline-block',
							boxSizing: 'border-box',
							minWidth: '85px',
							maxWidth: '85px',
						}}>
							Too Far
						</div>
					)}
				</div>
			))}
		</>
	);
}
