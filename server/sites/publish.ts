// Publish validation: what must be true before a demo site goes live.
// Returns every problem at once so the editor can show them together.

import { SAMPLE_TESTIMONIAL_AUTHOR, type Site } from '@shared/sites';
import { isValidCustomDomain } from './domain';

export function validatePublish(
  site: Pick<Site, 'data' | 'notifyEmail' | 'customDomain'>
): string[] {
  const errors: string[] = [];
  const { data } = site;

  if ((data.testimonials || []).some((t) => t.author === SAMPLE_TESTIMONIAL_AUTHOR)) {
    errors.push('Replace or remove the sample testimonials. Live sites can only show real reviews.');
  }
  if (!data.phone || !data.phone.trim()) {
    errors.push('Add a verified phone number.');
  }
  if (!site.notifyEmail || !site.notifyEmail.trim()) {
    errors.push('Set the notification email, so quote requests reach the owner.');
  }
  if (!(data.services || []).some((s) => s.name && s.name.trim())) {
    errors.push('Add at least one service.');
  }
  if (site.customDomain && !isValidCustomDomain(site.customDomain)) {
    errors.push(`The custom domain "${site.customDomain}" is not a valid hostname.`);
  }
  return errors;
}
