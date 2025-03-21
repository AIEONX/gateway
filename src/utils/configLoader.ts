import conf from '../../configStore.json';

interface ConfigStore {
  [slug: string]: string;
}

// Validate config structure at runtime
const configStore = conf as ConfigStore;

export function getConfigStringBySlug(slug: string): string {
  const configString = configStore[slug];

  if (!configString) {
    throw new Error(`Configuration string not found for slug: ${slug}`);
  }

  return configString;
}
