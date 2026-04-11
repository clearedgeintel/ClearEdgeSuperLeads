import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ProfileModalProps {
  profile: any;
  open: boolean;
  onClose: () => void;
}

export default function ProfileModal({ profile, open, onClose }: ProfileModalProps) {
  const [formData, setFormData] = useState({
    businessName: '',
    phone: '',
    description: '',
    hours: {} as any,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Initialize form data when profile changes
  useEffect(() => {
    if (profile) {
      setFormData({
        businessName: profile.businessName || '',
        phone: profile.phone || '',
        description: profile.description || '',
        hours: profile.hours || {},
      });
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const response = await apiRequest('POST', `/api/gbp-profile/${profile.locationId}/update`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/gbp-profiles'] });
      toast({
        title: "Profile Updated",
        description: "Google Business Profile has been updated successfully.",
      });
      onClose();
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleHoursChange = (day: string, type: 'open' | 'close', value: string) => {
    setFormData(prev => ({
      ...prev,
      hours: {
        ...prev.hours,
        [day]: {
          ...prev.hours[day],
          [type]: value,
        }
      }
    }));
  };

  if (!profile) return null;

  const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Profile - {profile.businessName}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="businessName">Business Name</Label>
              <Input
                id="businessName"
                value={formData.businessName}
                onChange={(e) => handleInputChange('businessName', e.target.value)}
                className="mt-1"
              />
            </div>
            
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                className="mt-1"
              />
            </div>
            
            <div>
              <Label htmlFor="description">Business Description</Label>
              <Textarea
                id="description"
                rows={4}
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                className="mt-1"
                placeholder="Describe your business, services, and what makes you unique..."
              />
            </div>
            
            <div>
              <Label>Business Hours</Label>
              <div className="space-y-2 mt-2">
                {daysOfWeek.map((day) => (
                  <div key={day} className="flex items-center space-x-3">
                    <span className="w-20 text-sm text-gray-600 capitalize">{day}</span>
                    <Input
                      type="time"
                      value={formData.hours[day]?.open || ''}
                      onChange={(e) => handleHoursChange(day, 'open', e.target.value)}
                      className="w-24"
                    />
                    <span className="text-gray-500">to</span>
                    <Input
                      type="time"
                      value={formData.hours[day]?.close || ''}
                      onChange={(e) => handleHoursChange(day, 'close', e.target.value)}
                      className="w-24"
                    />
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={formData.hours[day]?.closed || false}
                        onChange={(e) => handleHoursChange(day, 'closed' as any, e.target.checked as any)}
                      />
                      <span className="text-sm text-gray-600">Closed</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex space-x-4 pt-4 border-t border-gray-200">
            <Button 
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex-1"
            >
              {updateMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              ) : null}
              Save Changes
            </Button>
            <Button 
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
