# PGlite Migration User Guide

## Overview

DeepChat is migrating from a dual-database architecture (SQLite + DuckDB) to a unified PGlite-based solution. This migration will happen automatically when you upgrade to Version N, consolidating all your data into a single, more efficient database system.

## What is PGlite?

PGlite is a lightweight, WebAssembly-based PostgreSQL implementation that runs entirely within the application. It provides:

- **Unified Storage**: All conversations and knowledge base data in one database
- **Better Performance**: Optimized queries and reduced overhead
- **Vector Search**: Built-in pgvector extension for knowledge base operations
- **Reliability**: Full PostgreSQL compatibility with ACID transactions

## Migration Process

### Automatic Migration (Recommended)

When you first start Version N of DeepChat:

1. **Detection**: The application automatically detects your existing SQLite and DuckDB databases
2. **Backup Creation**: Your original databases are backed up with timestamps
3. **Migration Progress**: A progress dialog shows the migration status
4. **Verification**: Data integrity is verified after migration
5. **Completion**: The application starts normally with all your data preserved

### What Gets Migrated

- **All Conversations**: Every conversation, message, and attachment
- **Knowledge Base**: All uploaded files, chunks, and vector embeddings
- **Settings**: Conversation settings and user preferences
- **Relationships**: All data relationships are preserved

### Migration Timeline

The migration time depends on your data size:

- **Small datasets** (< 1GB): 1-5 minutes
- **Medium datasets** (1-10GB): 5-30 minutes  
- **Large datasets** (> 10GB): 30+ minutes

## Before You Migrate

### System Requirements

- **Disk Space**: Ensure you have at least 2x your current database size in free space
- **Permissions**: Make sure DeepChat has write access to its data directory
- **Backup**: While automatic backups are created, consider making your own backup

### Preparation Steps

1. **Close DeepChat**: Ensure the application is completely closed
2. **Free Disk Space**: Clear unnecessary files if space is limited
3. **Stable Power**: Ensure your device won't lose power during migration
4. **Network**: Migration doesn't require internet, but avoid network-intensive tasks

## During Migration

### What You'll See

- **Progress Dialog**: Shows current operation and percentage complete
- **Time Estimate**: Displays estimated time remaining
- **Current Operation**: Indicates what data is being migrated
- **Cancel Option**: Allows safe cancellation if needed

### What NOT to Do

- **Don't Force Quit**: Let the migration complete or use the Cancel button
- **Don't Move Files**: Avoid moving or deleting database files during migration
- **Don't Start Multiple Instances**: Only run one instance of DeepChat during migration

## After Migration

### Verification Steps

1. **Check Conversations**: Verify all your conversations are present
2. **Test Knowledge Base**: Try searching your knowledge base
3. **Review Settings**: Confirm your preferences are preserved
4. **Performance**: Notice improved performance in searches and queries

### What Changed

- **Single Database**: All data now stored in one PGlite database
- **Faster Searches**: Vector searches are now more efficient
- **Better Reliability**: Improved data consistency and transaction handling
- **Future-Ready**: Prepared for upcoming features and improvements

## Troubleshooting

If you encounter issues, see the [Migration Troubleshooting Guide](./pglite-migration-troubleshooting.md) for detailed solutions.

## Version N+1 Upgrade

When Version N+1 is released:

- **Automatic**: No additional migration needed
- **Legacy Removal**: Old database support is completely removed
- **Performance**: Further optimizations and new features
- **Requirement**: You must complete Version N migration first

## Support

If you need help:

1. Check the troubleshooting guide
2. Review the developer documentation for technical details
3. Contact support with your migration logs
4. Join the community forums for peer assistance

## FAQ

**Q: Will I lose any data during migration?**
A: No, the migration preserves 100% of your data and creates backups for safety.

**Q: Can I cancel the migration?**
A: Yes, you can safely cancel during the process. Your original databases remain untouched.

**Q: What if the migration fails?**
A: The application will continue using your original databases and provide error details for resolution.

**Q: How much disk space do I need?**
A: At least 2x your current database size to accommodate backups and the new database.

**Q: Can I skip Version N and go directly to N+1?**
A: No, you must upgrade to Version N first to perform the migration.