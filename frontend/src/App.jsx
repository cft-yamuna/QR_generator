import React, { useState, useEffect } from 'react';
import VisitorCheckIn from './components/VisitorCheckIn';
import VisitorDashboard from './components/VisitorDashboard';
import VisitorCard from './components/VisitorCard';
import Scanner from './components/Scanner';
import DisplayBoard from './components/DisplayBoard';

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [visitors, setVisitors] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [networkInfo, setNetworkInfo] = useState({ localIp: 'localhost', backendPort: '5001', frontendPort: '5173' });
  const [loading, setLoading] = useState(true);

  // History path watcher
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };

    const originalPushState = window.history.pushState;
    window.history.pushState = function() {
      originalPushState.apply(this, arguments);
      handleLocationChange();
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.history.pushState = originalPushState;
    };
  }, []);

  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // Load registration records and network data
  const loadData = async () => {
    try {
      setLoading(true);
      
      const netConfigResponse = await fetch('/api/network-info');
      if (netConfigResponse.ok) {
        const netConfig = await netConfigResponse.json();
        setNetworkInfo(netConfig);
      }

      const visitorsResponse = await fetch('/api/visitors');
      if (visitorsResponse.ok) {
        const data = await visitorsResponse.json();
        setVisitors(data);
      }
    } catch (err) {
      console.error("Connection failed with backend server:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Route matching rules
  const isVerifyRoute = currentPath.startsWith('/verify/') || currentPath === '/verify';
  const verifyVisitorId = currentPath.startsWith('/verify/') ? currentPath.split('/')[2] : null;

  const isVisitorRoute = currentPath.startsWith('/visitor/');
  const visitorId = isVisitorRoute ? currentPath.split('/')[2] : null;

  const isAdminRoute = currentPath === '/admin';
  const isDisplayRoute = currentPath === '/display';
  const isRegisterRoute = currentPath === '/register';

  // Redirect /register to home page where registration is now embedded
  useEffect(() => {
    if (isRegisterRoute) {
      navigateTo('/');
    }
  }, [isRegisterRoute]);

  // 0. TV Display Board (no header, no chrome)
  if (isDisplayRoute) {
    return <DisplayBoard />;
  }

  // 1. Scanner / Check-in Page
  if (isVerifyRoute) {
    return (
      <Scanner 
        visitorId={verifyVisitorId} 
        onBack={() => navigateTo('/')}
      />
    );
  }

  // 2. Individual Ticket Pass page
  if (isVisitorRoute && visitorId) {
    const activeVisitor = visitors.find(v => v.id.toLowerCase().trim() === visitorId.toLowerCase().trim());
    
    if (loading && !activeVisitor) {
      return (
        <div className="flex-center">
          <div className="spinner"></div>
        </div>
      );
    }

    if (!activeVisitor) {
      return (
        <div className="flex-center">
          <div className="card" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h2 style={{ marginBottom: '1rem' }}>Pass Not Found</h2>
            <button onClick={() => navigateTo('/')} className="btn btn-primary">
              Go to Home Page
            </button>
          </div>
        </div>
      );
    }

    return (
      <VisitorCard 
        visitor={activeVisitor}
        networkInfo={networkInfo}
        onBack={() => {
          navigateTo('/');
          loadData(); // reload registry list status
        }}
      />
    );
  }

  // 3. Admin Panel List
  if (isAdminRoute) {
    if (loading) {
      return (
        <div className="flex-center">
          <div className="spinner"></div>
        </div>
      );
    }
    return (
      <VisitorDashboard 
        visitors={visitors}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        onViewVisitor={(visitor) => navigateTo(`/visitor/${visitor.id}`)}
      />
    );
  }

  // 4. Standalone Registration page (Redirecting to home page)
  if (isRegisterRoute) {
    return (
      <div className="flex-center">
        <div className="spinner"></div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-center">
        <div className="spinner"></div>
      </div>
    );
  }

  // 5. Default/Fallback: Home Page Check-In Form (pre-registered visitors)
  return (
    <VisitorCheckIn 
      networkInfo={networkInfo}
      onGoToAdmin={() => navigateTo('/admin')}
    />
  );
}
