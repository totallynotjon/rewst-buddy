import vscode from 'vscode';

interface CommandContext {
	context: vscode.ExtensionContext;
	commandPrefix: string;
}

export default abstract class GenericCommand {
	abstract commandName: string;

	abstract execute(...args: unknown[]): Promise<unknown>;
}

//allow generic instantiation of classes that extend this base
export function createCommand<T extends GenericCommand>(ctor: new (...args: any[]) => T, ...args: any[]): T {
	return new ctor(...args);
}
