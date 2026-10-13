import { lifecycle } from './local.mjs';
export function createSeed() {
 return { ...lifecycle, product: 'Dial', setup: { manifestFile: 'rer-setup.json' }, browserModule: 'scripts/installer/ui/seed.mjs', theme: 'public/rer-theme.css' };
}
