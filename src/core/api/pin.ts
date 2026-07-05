// PIN Security APIs
import { loadSecuritySettings, updateSecuritySettings } from './identity';

// Simple hash function for PIN (client-side only, no external deps)
async function hashPin(pin: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + 'ams-pin-salt-2026');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const pinApi = {
    /**
     * Set or update PIN for user
     */
    async setPin(userId: string, pin: string): Promise<void> {
        const pinHash = await hashPin(pin);
        await updateSecuritySettings(userId, { pin_hash: pinHash });
    },

    /**
     * Verify PIN
     */
    async verifyPin(userId: string, pin: string): Promise<boolean> {
        const settings = await loadSecuritySettings(userId);
        if (!settings.pin_hash) return false;

        const inputHash = await hashPin(pin);
        return settings.pin_hash === inputHash;
    },

    /**
     * Remove PIN
     */
    async removePin(userId: string): Promise<void> {
        await updateSecuritySettings(userId, { pin_hash: null });
    },

    /**
     * Check if user has PIN set
     */
    async hasPin(userId: string): Promise<boolean> {
        const settings = await loadSecuritySettings(userId);
        return !!settings.pin_hash;
    },

    /**
     * Get idle timeout setting (minutes)
     */
    async getIdleTimeout(userId: string): Promise<number> {
        const settings = await loadSecuritySettings(userId);
        return settings.idle_timeout;
    },

    /**
     * Set idle timeout setting (minutes)
     */
    async setIdleTimeout(userId: string, minutes: number): Promise<void> {
        await updateSecuritySettings(userId, { idle_timeout: minutes });
    },
};
