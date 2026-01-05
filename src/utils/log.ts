import { context } from '@global';
import vscode from 'vscode';

/**
 * Modern logging system using VSCode's LogOutputChannel API
 *
 * Features:
 * - trace/debug: Development only (zero-cost in production)
 * - info/warn/error: All environments
 * - Automatic integration with "Developer: Show Extension Logs"
 * - VSCode manages all file writing and rotation
 */
class Logger {
	private logChannel!: vscode.LogOutputChannel;
	private isDevelopment = false;

	/**
	 * Initialize logger with extension context
	 * Call this once during extension activation
	 */
	init(): void {
		// Create VSCode managed log channel
		this.logChannel = vscode.window.createOutputChannel('rewst-buddy', { log: true });

		// Detect environment
		this.isDevelopment = context.extensionMode === vscode.ExtensionMode.Development;

		// Register for cleanup
		context.subscriptions.push(this.logChannel);

		this.info(`Logger initialized (${this.isDevelopment ? 'DEVELOPMENT' : 'PRODUCTION'} mode)`);
	}

	/**
	 * TRACE - Most verbose, development only
	 * Use for detailed execution flow
	 */
	trace(message: string, ...args: any[]): void {
		if (!this.isDevelopment) return;
		this.logChannel.trace(message, ...args);
		if (this.isDevelopment) {
			console.log(`[TRACE] ${message}`, ...args);
		}
	}

	/**
	 * DEBUG - Development only
	 * Use for debugging information
	 */
	debug(message: string, ...args: any[]): void {
		if (!this.isDevelopment) return;
		this.logChannel.debug(message, ...args);
		if (this.isDevelopment) {
			console.log(`[DEBUG] ${message}`, ...args);
		}
	}

	/**
	 * INFO - All environments
	 * Use for general informational messages
	 */
	info(message: string, ...args: any[]): void {
		this.logChannel.info(message, ...args);
		if (this.isDevelopment) {
			console.log(`[INFO] ${message}`, ...args);
		}
	}

	/**
	 * WARN - All environments
	 * Use for warning conditions
	 */
	warn(message: string, ...args: any[]): void {
		this.logChannel.warn(message, ...args);
		if (this.isDevelopment) {
			console.warn(`[WARN] ${message}`, ...args);
		}
	}

	/**
	 * ERROR - All environments
	 * Use for error conditions
	 */
	error(message: string, error?: Error | unknown, ...args: any[]): Error {
		if (error instanceof Error) {
			const fullMessage = `${message} ${error.message}`;
			this.logChannel.error(message, error, ...args);
			if (this.isDevelopment) {
				console.error(`[ERROR] ${message}`, error, ...args);
			}
			return new Error(fullMessage);
		} else if (error) {
			const errorMsg = String(error);
			const fullMessage = `${message} ${errorMsg}`;
			this.logChannel.error(message, error, ...args);
			if (this.isDevelopment) {
				console.error(`[ERROR] ${message}`, error, ...args);
			}
			return new Error(fullMessage);
		} else {
			this.logChannel.error(message, ...args);
			if (this.isDevelopment) {
				console.error(`[ERROR] ${message}`, ...args);
			}
			return new Error(message);
		}
	}

	/**
	 * INFO + User Notification
	 * Logs at INFO level and shows information message to user
	 */
	notifyInfo(message: string, ...args: any[]): void {
		this.info(message, ...args);
		vscode.window.showInformationMessage(message);
	}

	/**
	 * WARN + User Notification
	 * Logs at WARN level and shows warning message to user
	 */
	notifyWarn(message: string, ...args: any[]): void {
		this.warn(message, ...args);
		vscode.window.showWarningMessage(message);
	}

	/**
	 * ERROR + User Notification
	 * Logs at ERROR level and shows error message to user
	 */
	notifyError(message: string, error?: Error | unknown, ...args: any[]): Error {
		const err = this.error(message, error, ...args);
		vscode.window.showErrorMessage(err.message);
		return err;
	}

	/**
	 * Show the log output channel to user
	 */
	show(preserveFocus = true): void {
		this.logChannel.show(preserveFocus);
	}
}

export const log = new Logger();
