import axios from 'axios';

export interface HubSpotCompanyInput {
  name: string;
  domain?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  website?: string;
  description?: string;
  numberofemployees?: number;
  business_email?: string; // custom property
}

export interface HubSpotCompanyResult {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export class HubSpotService {
  private accessToken: string;
  private baseUrl = 'https://api.hubapi.com';
  private customPropertyEnsured = false;

  constructor() {
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN || '';
  }

  isConfigured(): boolean {
    return !!this.accessToken;
  }

  /**
   * Ensure the custom `business_email` property exists on the Company object.
   * Creates it on first call, no-ops on subsequent calls.
   */
  async ensureBusinessEmailProperty(): Promise<void> {
    if (this.customPropertyEnsured) return;

    try {
      // Check if property exists
      await axios.get(
        `${this.baseUrl}/crm/v3/properties/companies/business_email`,
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          timeout: 10000,
        }
      );
      this.customPropertyEnsured = true;
    } catch (error: any) {
      if (error.response?.status === 404) {
        // Property doesn't exist — create it
        try {
          await axios.post(
            `${this.baseUrl}/crm/v3/properties/companies`,
            {
              name: 'business_email',
              label: 'Business Email',
              type: 'string',
              fieldType: 'text',
              groupName: 'companyinformation',
              description: 'Primary contact email for the business (added by GBP Console)',
            },
            {
              headers: {
                Authorization: `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            }
          );
          this.customPropertyEnsured = true;
          console.log('[HubSpot] Created custom property: business_email');
        } catch (createError: any) {
          console.error('[HubSpot] Failed to create business_email property:', createError.response?.data || createError.message);
          // Don't throw — let the push continue without the email property
        }
      } else {
        console.error('[HubSpot] Failed to check business_email property:', error.response?.data || error.message);
      }
    }
  }

  /**
   * Create a Company in HubSpot. If a company with the same domain already
   * exists, returns the existing company instead of creating a duplicate.
   */
  async createCompany(input: HubSpotCompanyInput): Promise<HubSpotCompanyResult> {
    if (!this.accessToken) {
      throw new Error('HUBSPOT_ACCESS_TOKEN must be configured');
    }

    // Make sure custom email property exists before sending
    if (input.business_email) {
      await this.ensureBusinessEmailProperty();
    }

    // Try to find existing company by domain to avoid duplicates
    if (input.domain) {
      const existing = await this.findCompanyByDomain(input.domain);
      if (existing) {
        // Update existing with any new info
        return this.updateCompany(existing.id, input);
      }
    }

    const properties = this.buildProperties(input);

    try {
      const response = await axios.post(
        `${this.baseUrl}/crm/v3/objects/companies`,
        { properties },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      return {
        id: response.data.id,
        createdAt: response.data.createdAt,
        updatedAt: response.data.updatedAt,
      };
    } catch (error: any) {
      console.error('[HubSpot] createCompany error:', JSON.stringify(error.response?.data, null, 2));
      throw new Error(
        `HubSpot create failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async updateCompany(companyId: string, input: HubSpotCompanyInput): Promise<HubSpotCompanyResult> {
    const properties = this.buildProperties(input);

    try {
      const response = await axios.patch(
        `${this.baseUrl}/crm/v3/objects/companies/${companyId}`,
        { properties },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      return {
        id: response.data.id,
        createdAt: response.data.createdAt,
        updatedAt: response.data.updatedAt,
      };
    } catch (error: any) {
      console.error('[HubSpot] updateCompany error:', JSON.stringify(error.response?.data, null, 2));
      throw new Error(
        `HubSpot update failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Find an existing company by domain. Returns null if none found.
   */
  async findCompanyByDomain(domain: string): Promise<{ id: string } | null> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/crm/v3/objects/companies/search`,
        {
          filterGroups: [
            {
              filters: [
                { propertyName: 'domain', operator: 'EQ', value: domain },
              ],
            },
          ],
          limit: 1,
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const result = response.data.results?.[0];
      return result ? { id: result.id } : null;
    } catch (error: any) {
      console.error('[HubSpot] findCompanyByDomain error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Build the HubSpot properties object, only including fields with values.
   * HubSpot rejects properties with null/undefined or non-existent property names.
   */
  private buildProperties(input: HubSpotCompanyInput): Record<string, any> {
    const props: Record<string, any> = {};

    if (input.name) props.name = input.name;
    if (input.domain) props.domain = input.domain;
    if (input.phone) props.phone = input.phone;
    if (input.address) props.address = input.address;
    if (input.city) props.city = input.city;
    if (input.state) props.state = input.state;
    if (input.zip) props.zip = input.zip;
    if (input.website) props.website = input.website;
    if (input.description) props.description = input.description;
    if (input.numberofemployees) props.numberofemployees = input.numberofemployees;
    if (input.business_email) props.business_email = input.business_email;

    return props;
  }
}

/**
 * Extract domain from a URL. Returns null for invalid URLs.
 */
export function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Parse a US-formatted address string into city/state/zip.
 * Best-effort — handles the common Places API format like:
 *   "123 Main St, San Francisco, CA 94102, USA"
 */
export function parseAddress(address: string | null | undefined): {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
} {
  if (!address) return {};

  const parts = address.split(',').map(p => p.trim());
  if (parts.length < 3) return { street: parts[0] };

  // Last part is country (USA), second-to-last is "STATE ZIP"
  const stateZipPart = parts[parts.length - 2];
  const stateZipMatch = stateZipPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);

  return {
    street: parts[0],
    city: parts[parts.length - 3],
    state: stateZipMatch?.[1],
    zip: stateZipMatch?.[2],
  };
}

export const hubspotService = new HubSpotService();
