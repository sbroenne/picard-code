export const NEMOTRON_VERSION: string;
export const NEMOTRON_MODEL: string;
export function nemotronArchive(platform?: string, arch?: string, glibc?: string): { file: string; checksum: string };
export function downloadVerified(url: string, target: string, checksum: string): Promise<void>;
export function setupNemotron(home: string): Promise<void>;
