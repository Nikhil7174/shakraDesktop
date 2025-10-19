// Configure Monaco Editor for Vite + npm package method
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Import Monaco workers for Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// TypeScript declarations for Monaco Environment
declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (moduleId: string, label: string) => Worker;
    };
    process?: {
      type: string;
    };
  }
}

// Track initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize Monaco Editor with Vite workers and npm package configuration
 * @returns Promise that resolves when Monaco is fully initialized
 */
export const initializeMonaco = async (): Promise<void> => {
  // Return existing promise if already initializing
  if (initializationPromise) {
    return initializationPromise;
  }

  // Return immediately if already initialized
  if (isInitialized) {
    return Promise.resolve();
  }

  console.log('Setting up Monaco Environment for Vite...');

  // Set up Monaco Environment for Vite workers
  self.MonacoEnvironment = {
    getWorker(_, label) {
      console.log('Monaco requesting worker for label:', label);
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };

  // Configure Monaco loader to use npm package
  console.log('Configuring Monaco loader to use npm package...');

  try {
    loader.config({ monaco });
    console.log('Monaco loader configured with npm package');
  } catch (error) {
    console.error('Failed to configure Monaco loader:', error);
    throw new Error(`Monaco loader configuration failed: ${error}`);
  }

  // Initialize Monaco using the loader
  try {
    const monacoInstance = await loader.init();
    console.log('Monaco initialized successfully:', monacoInstance);
    isInitialized = true;
  } catch (error) {
    console.error('Failed to initialize Monaco:', error);
    throw new Error(`Monaco initialization failed: ${error}`);
  }
};

// Create the initialization promise
initializationPromise = initializeMonaco();

/**
 * Check if Monaco Editor is ready
 * @returns boolean indicating if Monaco is initialized
 */
export const isMonacoReady = (): boolean => {
  return isInitialized && typeof window !== 'undefined' && !!window.MonacoEnvironment;
};

/**
 * Get Monaco initialization promise (for lazy loading)
 * @returns Promise that resolves when Monaco is ready
 */
export const getMonacoPromise = (): Promise<void> => {
  return initializationPromise || initializeMonaco();
};
