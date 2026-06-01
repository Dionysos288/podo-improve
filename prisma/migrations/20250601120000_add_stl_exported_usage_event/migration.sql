-- Add STL_EXPORTED to UsageEventType (export quota: STL, G-code, EVA NC)
ALTER TYPE "UsageEventType" ADD VALUE IF NOT EXISTS 'STL_EXPORTED';
