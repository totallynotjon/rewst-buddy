import vscode from 'vscode';
import { createGlobal } from './BaseGlobal';

export const context = createGlobal<vscode.ExtensionContext>();
