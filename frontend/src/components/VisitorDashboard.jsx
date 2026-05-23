import React from 'react';

export default function VisitorDashboard({ 
  visitors, 
  searchTerm, 
  setSearchTerm, 
  onViewVisitor 
}) {
  
  // Filter visitors by name, employeeId, email, or ID
  const filteredVisitors = visitors.filter(visitor => {
    const term = searchTerm.toLowerCase();
    return (
      visitor.name.toLowerCase().includes(term) ||
      (visitor.employeeId && visitor.employeeId.toLowerCase().includes(term)) ||
      (visitor.email && visitor.email.toLowerCase().includes(term)) ||
      visitor.id.toLowerCase().includes(term)
    );
  });

  return (
    <div className="container">
      <div style={{ marginBottom: '2.5rem' }}>
        <h1>Visitor Gate</h1>
        <p className="subtitle">Admin Panel & Visitor Registry</p>
      </div>

      <div className="card">
        {/* Search */}
        <div className="search-container" style={{ position: 'relative', marginBottom: '2rem' }}>
          <input 
            type="text" 
            placeholder="Search visitors by name, ID or Employee ID..." 
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.85rem 1rem', background: '#0B0E14', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'white', fontSize: '0.95rem' }}
          />
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Visitor ID</th>
                <th>Full Name</th>
                <th>Employee ID</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVisitors.map(visitor => (
                <tr key={visitor.id} className="admin-row">
                  <td>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{visitor.id}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'white' }}>{visitor.name}</div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{visitor.employeeId || 'N/A'}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${visitor.checkinStatus === 'Checked In' ? 'checked' : 'pending'}`}>
                      {visitor.checkinStatus === 'Checked In' ? '● Checked In' : '● Pending'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <a 
                      href="#" 
                      className="btn-link"
                      onClick={(e) => { e.preventDefault(); onViewVisitor(visitor); }}
                    >
                      View Pass →
                    </a>
                  </td>
                </tr>
              ))}
              {filteredVisitors.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No visitor records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

