#!/usr/bin/env node

/**
 * Update pnpm-workspace.yaml supportedArchitectures for different platforms
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { platform, arch } from 'os';
import YAML from 'yaml';

// Get platform info from environment or system
const targetOS = process.env.TARGET_OS || process.env.npm_config_os || platform();
const targetArch = process.env.TARGET_ARCH || process.env.npm_config_arch || arch();

console.log(`🎯 Configuring pnpm workspace for platform: ${targetOS}-${targetArch}`);

// Define platform-specific configurations
const platformConfigs = {
  'win32-x64': {
    os: ['current', 'win32'],
    cpu: ['current', 'x64']
  },
  'win32-arm64': {
    os: ['current', 'win32'],
    cpu: ['current', 'arm64']
  },
  'linux-x64': {
    os: ['current', 'linux'],
    cpu: ['current', 'x64', 'wasm32'], // Include wasm32 for Sharp WebAssembly
    libc: ['glibc'],
  },
  'linux-arm64': {
    os: ['current', 'linux'],
    cpu: ['current', 'arm64', 'wasm32'],
    libc: ['glibc'],
  },
  'darwin-x64': {
    os: ['current', 'darwin'],
    cpu: ['current', 'x64'],
  },
  'darwin-arm64': {
    os: ['current', 'darwin'],
    cpu: ['current', 'arm64'],
  }
};

const platformKey = `${targetOS}-${targetArch}`;
const config = platformConfigs[platformKey];

if (!config) {
  console.warn(`⚠️  No specific configuration for ${platformKey}, using default`);
  console.log(`📝 Keeping existing pnpm-workspace.yaml configuration`);
  process.exit(0);
}

const workspaceFile = 'pnpm-workspace.yaml';

try {
  let workspaceConfig = {};

  // Read and parse existing file if it exists
  if (existsSync(workspaceFile)) {
    const existingContent = readFileSync(workspaceFile, 'utf8');
    try {
      workspaceConfig = YAML.parse(existingContent) || {};
      console.log(`📖 Parsed existing pnpm-workspace.yaml`);
    } catch (parseError) {
      console.warn(`⚠️  Failed to parse existing YAML, creating new config: ${parseError.message}`);
      workspaceConfig = {};
    }
  }

  // Update supportedArchitectures configuration
  workspaceConfig.supportedArchitectures = {
    os: config.os,
    cpu: config.cpu
  };
  if (config.libc) {
    workspaceConfig.supportedArchitectures.libc = config.libc;
  }

  // Convert back to YAML with proper formatting
  const finalContent = YAML.stringify(workspaceConfig, {
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0
  });

  writeFileSync(workspaceFile, finalContent, 'utf8');
  console.log(`✅ Updated pnpm-workspace.yaml for ${platformKey}`);
  console.log(`📋 Configuration:`);
  console.log(`   OS: ${config.os.join(', ')}`);
  console.log(`   CPU: ${config.cpu.join(', ')}`);
  if (config.libc) {
    console.log(`   Libc: ${config.libc.join(', ')}`);
  }
} catch (error) {
  console.error(`❌ Failed to update pnpm-workspace.yaml: ${error.message}`);
  process.exit(1);
}

console.log(`🎉 Platform configuration completed. Run 'pnpm install' to install dependencies.`);
