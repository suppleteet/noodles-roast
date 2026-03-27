import type { RigConfig } from "@/engine/types";

/**
 * Puppet-specific rig config. Extends RigConfig with room for puppet-specific
 * metadata (persona, voice, thumbnail) as the system grows.
 */
export interface PuppetConfig extends RigConfig {
  // Future fields: persona, voice, thumbnail, etc.
}
