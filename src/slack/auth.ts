/**
 * Authentication utilities for Slack Terminal
 * Handles user ID whitelist checking
 */

/**
 * Checks if a Slack user ID is authorized to use the terminal relay
 * @param userId - The Slack user ID to check
 * @param allowedUserId - The whitelisted user ID from configuration
 * @returns true if the user is authorized, false otherwise
 */
export function isAuthorizedUser(userId: string, allowedUserId: string): boolean {
    // Both IDs must be non-empty strings
    if (!userId || !allowedUserId) {
        return false;
    }

    // Trim whitespace and compare
    return userId.trim() === allowedUserId.trim();
}
