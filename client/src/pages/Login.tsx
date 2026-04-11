import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [isLoading, setIsLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const { toast } = useToast();

  const requireAcceptance = (): boolean => {
    if (!termsAccepted) {
      toast({
        title: 'Accept the Terms first',
        description: 'Check the box below before continuing.',
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const handleGoogleLogin = () => {
    if (!requireAcceptance()) return;
    window.location.href = '/api/auth/google';
  };

  const handleDemoLogin = async () => {
    if (!requireAcceptance()) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        toast({
          title: "Demo Login Successful",
          description: "Welcome to GBP Pro Console!",
        });
        // Reload the page to trigger authentication check
        window.location.reload();
      } else {
        throw new Error('Demo login failed');
      }
    } catch (error) {
      toast({
        title: "Login Failed",
        description: "Unable to log in with demo account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary to-secondary flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardContent className="pt-8 pb-8 px-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
              <MapPin className="text-white h-8 w-8" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">GBP Pro Console</h1>
            <p className="text-gray-600">Google Business Profile Management for Consultants</p>
          </div>
          
          <Button 
            onClick={handleGoogleLogin}
            variant="outline"
            className="w-full py-3 flex items-center justify-center space-x-3 hover:border-gray-300 mb-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span className="font-medium text-gray-700">Continue with Google</span>
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-muted-foreground">Or try demo</span>
            </div>
          </div>

          <Button 
            onClick={handleDemoLogin}
            disabled={isLoading}
            className="w-full py-3"
          >
            {isLoading ? "Logging in..." : "Demo Login"}
          </Button>
          
          <p className="text-xs text-gray-500 text-center mt-4">
            Demo account provides full access to test all features
          </p>

          {/* Terms acceptance + legal links */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
