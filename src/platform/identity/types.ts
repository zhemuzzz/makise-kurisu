/**
 * 人设引擎类型定义
 */

export interface PersonaHardcoded {
  content: string;
}

export interface MentalModel {
  user_profile: {
    name: string;
    relationship: 'stranger' | 'acquaintance' | 'friend' | 'close';
    preferences: string[];
  };
  relationship_graph: {
    trust_level: number;
    familiarity: number;
    emotional_state: string;
  };
  shared_memories: {
    key_events: string[];
    inside_jokes: string[];
    repeated_topics: string[];
  };
}

export interface ValidationResult {
  isValid: boolean;
  violations: string[];
  shouldRegenerate: boolean;
}
