import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { MapPin, LogOut } from "lucide-react";
import LeadDiscovery from "@/components/LeadDiscovery";
import LinkedInLeads from "@/components/LinkedInLeads";
import CampaignBuilder from "@/components/CampaignBuilder";
import SendQueue from "@/components/SendQueue";
import Inbox from "@/components/Inbox";
import ProfileManagement from "@/components/ProfileManagement";
import EmailOutreach from "@/components/EmailOutreach";
import Analytics from "@/components/Analytics";
import Reports from "@/components/Reports";
import Settings from "@/components/Settings";

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('leadDiscovery');
  const [apiStatus, setApiStatus] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !user) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/auth/google";
      }, 500);
      return;
    }
  }, [user, isLoading, toast]);

  useEffect(() => {
    // Check API status
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setApiStatus(data.services || {}))
      .catch(console.error);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect via useEffect
  }

  const navItems = [
    { id: 'leadDiscovery', label: 'Google Leads', icon: 'search' },
    { id: 'linkedinLeads', label: 'LinkedIn Leads', icon: 'linkedin' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone' },
    { id: 'sendQueue', label: 'Send Queue', icon: 'list-check' },
    { id: 'inbox', label: 'Inbox', icon: 'inbox' },
    { id: 'profileManagement', label: 'GBP Profiles', icon: 'store' },
    { id: 'emailOutreach', label: 'Email Outreach', icon: 'envelope' },
    { id: 'analytics', label: 'Analytics', icon: 'chart-bar' },
    { id: 'reports', label: 'Reports', icon: 'chart-line' },
    { id: 'settings', label: 'Settings', icon: 'cog' }
  ];

  const getInitials = (firstName?: string, lastName?: string) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || 'U';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <MapPin className="text-white h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">GBP Pro Console</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <div className={`w-2 h-2 rounded-full ${apiStatus.googleAuth ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span>Connected to Google Business API</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-white text-sm font-medium">
                  {getInitials(user.firstName, user.lastName)}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-700">
                {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar Navigation */}
        <nav className="w-64 bg-white border-r border-gray-200 min-h-screen">
          <div className="p-6">
            <div className="space-y-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    activeTab === item.id
                      ? 'bg-primary text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <i className={`fas fa-${item.icon}`}></i>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
          
          <div className="px-6 py-4 border-t border-gray-200 mt-8">
            <div className="text-xs text-gray-500 mb-2">API Status</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Google Places API</span>
                <div className={`w-2 h-2 rounded-full ${apiStatus.googlePlaces ? 'bg-green-500' : 'bg-red-500'}`}></div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Claude AI</span>
                <div className={`w-2 h-2 rounded-full ${apiStatus.anthropic ? 'bg-green-500' : 'bg-red-500'}`}></div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Gmail SMTP</span>
                <div className={`w-2 h-2 rounded-full ${apiStatus.email ? 'bg-green-500' : 'bg-red-500'}`}></div>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 p-6">
          {activeTab === 'leadDiscovery' && <LeadDiscovery />}
          {activeTab === 'linkedinLeads' && <LinkedInLeads />}
          {activeTab === 'campaigns' && <CampaignBuilder />}
          {activeTab === 'sendQueue' && <SendQueue />}
          {activeTab === 'inbox' && <Inbox />}
          {activeTab === 'profileManagement' && <ProfileManagement />}
          {activeTab === 'emailOutreach' && <EmailOutreach />}
          {activeTab === 'analytics' && <Analytics />}
          {activeTab === 'reports' && <Reports />}
          {activeTab === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
