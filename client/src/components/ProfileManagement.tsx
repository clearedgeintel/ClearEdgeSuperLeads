import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Store, Edit, AlertTriangle } from "lucide-react";
import ProfileModal from "./ProfileModal";

export default function ProfileManagement() {
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: profiles = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/gbp-profiles'],
  });

  const handleEditProfile = (profile: any) => {
    setSelectedProfile(profile);
    setIsModalOpen(true);
  };

  const getStatusColor = (isActive: boolean, lastSynced?: string) => {
    if (!isActive) return 'bg-red-100 text-red-800';
    
    if (lastSynced) {
      const lastSync = new Date(lastSynced);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (lastSync < weekAgo) {
        return 'bg-yellow-100 text-yellow-800';
      }
    }
    
    return 'bg-green-100 text-green-800';
  };

  const getStatusText = (isActive: boolean, lastSynced?: string) => {
    if (!isActive) return 'Inactive';
    
    if (lastSynced) {
      const lastSync = new Date(lastSynced);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (lastSync < weekAgo) {
        return 'Needs Attention';
      }
    }
    
    return 'Active';
  };

  const getCategoryIcon = (category?: string) => {
    const cat = category?.toLowerCase() || '';
    if (cat.includes('restaurant') || cat.includes('cafe') || cat.includes('food')) {
      return '🍽️';
    }
    if (cat.includes('shop') || cat.includes('store') || cat.includes('retail')) {
      return '🏪';
    }
    if (cat.includes('service') || cat.includes('repair') || cat.includes('auto')) {
      return '🔧';
    }
    if (cat.includes('salon') || cat.includes('beauty') || cat.includes('spa')) {
      return '💄';
    }
    return '🏢';
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Loading Google Business Profiles...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Store className="h-5 w-5" />
            <span>Google Business Profiles</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <div className="text-center py-8">
              <Store className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No profiles found</h3>
              <p className="text-gray-600">
                Connect your Google Business Profile accounts to manage them here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {profiles.map((profile: any) => (
                <Card 
                  key={profile.id} 
                  className="hover:border-primary transition-colors cursor-pointer"
                  onClick={() => handleEditProfile(profile)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center text-white text-xl">
                        {getCategoryIcon(profile.category)}
                      </div>
                      <Badge className={getStatusColor(profile.isActive, profile.lastSynced)}>
                        {getStatusText(profile.isActive, profile.lastSynced)}
                      </Badge>
                    </div>
                    
                    <h3 className="font-semibold text-gray-900 mb-1">{profile.businessName}</h3>
                    <p className="text-sm text-gray-600 mb-3">{profile.address || 'Address not available'}</p>
                    
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">
                        Last updated: {profile.lastSynced ? 
                          new Date(profile.lastSynced).toLocaleDateString() : 
                          'Never'
                        }
                      </span>
                      <div className="flex items-center space-x-1">
                        {profile.rating && (
                          <>
                            <span className="text-yellow-500">★</span>
                            <span className="text-primary font-medium">
                              {profile.rating} ({profile.totalReviews || 0} reviews)
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
                      <span className="text-sm text-gray-600">
                        {profile.category || 'Uncategorized'}
                      </span>
                      <Edit className="h-4 w-4 text-gray-400" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profile Edit Modal */}
      <ProfileModal
        profile={selectedProfile}
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
