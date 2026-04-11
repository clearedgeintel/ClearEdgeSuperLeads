import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL || 'http://localhost:5000'}/api/auth/google/callback`
);

export class GoogleAuthService {
  getAuthUrl(): string {
    const scopes = [
      'openid',
      'email',
      'profile'
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      include_granted_scopes: true,
      state: 'gbp_auth_' + Date.now()
    });
  }

  async getTokens(code: string) {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  async getUserInfo(accessToken: string) {
    oauth2Client.setCredentials({ access_token: accessToken });
    const people = google.people({ version: 'v1', auth: oauth2Client });
    const { data } = await people.people.get({
      resourceName: 'people/me',
      personFields: 'names,emailAddresses,photos'
    });
    
    // Transform People API response to match our expected format
    return {
      id: data.resourceName?.replace('people/', ''),
      email: data.emailAddresses?.[0]?.value,
      given_name: data.names?.[0]?.givenName,
      family_name: data.names?.[0]?.familyName,
      picture: data.photos?.[0]?.url
    };
  }

  async refreshAccessToken(refreshToken: string) {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    return credentials;
  }

  setCredentials(accessToken: string, refreshToken?: string) {
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    return oauth2Client;
  }
}

export const googleAuthService = new GoogleAuthService();
