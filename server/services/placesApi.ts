import axios from 'axios';

export interface PlaceDetails {
  placeId: string;
  name: string;
  formattedAddress?: string;
  phone?: string;
  website?: string;
  rating?: number;
  totalReviews?: number;
  businessHours?: string[];
  types?: string[];
  priceLevel?: number;
  businessStatus?: string;
}

export class PlacesApiService {
  private apiKey: string;
  private baseUrl = 'https://places.googleapis.com/v1/places';

  constructor() {
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || '';
  }

  /**
   * Search Places API for multiple businesses matching a query and location.
   * Used for primary lead discovery.
   */
  async searchPlaces(query: string, location?: string, maxResults = 20): Promise<PlaceDetails[]> {
    if (!this.apiKey) {
      throw new Error('Google Places API key must be configured (GOOGLE_PLACES_API_KEY)');
    }

    const textQuery = location ? `${query} in ${location}` : query;

    try {
      const response = await axios.post(
        `${this.baseUrl}:searchText`,
        { textQuery, maxResultCount: maxResults },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.nationalPhoneNumber',
              'places.websiteUri',
              'places.rating',
              'places.userRatingCount',
              'places.currentOpeningHours',
              'places.types',
              'places.priceLevel',
              'places.businessStatus',
              'places.primaryType',
            ].join(','),
          },
          timeout: 10000,
        }
      );

      const places = response.data.places || [];
      return places.map((place: any) => this.mapPlace(place));
    } catch (error: any) {
      console.error('[Places] searchText error:', JSON.stringify(error.response?.data, null, 2));
      throw new Error(`Places search failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Search for a single place by business name and location.
   * Used for enrichment when we already have a lead.
   */
  async findPlace(businessName: string, location?: string): Promise<PlaceDetails | null> {
    if (!this.apiKey) return null;

    try {
      const results = await this.searchPlaces(businessName, location, 1);
      return results[0] || null;
    } catch (error: any) {
      console.error('Places findPlace error:', error.message);
      return null;
    }
  }

  private mapPlace(place: any): PlaceDetails {
    return {
      placeId: place.id,
      name: place.displayName?.text || 'Unknown',
      formattedAddress: place.formattedAddress,
      phone: place.nationalPhoneNumber,
      website: place.websiteUri,
      rating: place.rating,
      totalReviews: place.userRatingCount,
      businessHours: place.currentOpeningHours?.weekdayDescriptions,
      types: place.types,
      priceLevel: place.priceLevel,
      businessStatus: place.businessStatus,
    };
  }

  /**
   * Enrich a lead with Places API data. Returns only the fields that
   * the Places API found — caller merges with existing data.
   */
  async enrichLead(businessName: string, location?: string): Promise<Partial<PlaceDetails> | null> {
    const place = await this.findPlace(businessName, location);
    if (!place) return null;

    // Only return fields that have actual values
    const enriched: Partial<PlaceDetails> = { placeId: place.placeId };

    if (place.formattedAddress) enriched.formattedAddress = place.formattedAddress;
    if (place.phone) enriched.phone = place.phone;
    if (place.website) enriched.website = place.website;
    if (place.rating) enriched.rating = place.rating;
    if (place.totalReviews) enriched.totalReviews = place.totalReviews;
    if (place.businessHours) enriched.businessHours = place.businessHours;
    if (place.types?.length) enriched.types = place.types;
    if (place.businessStatus) enriched.businessStatus = place.businessStatus;

    return enriched;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

export const placesApiService = new PlacesApiService();
