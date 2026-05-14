export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      event_forecast_snapshots: {
        Row: {
          chance_of_impact: number | null
          change_tag: Database["public"]["Enums"]["forecast_change_tag"]
          created_at: string
          data_sources: Json
          decision_label: string | null
          event_id: string
          id: string
          is_final: boolean
          main_threat: string | null
          previous_snapshot_id: string | null
          stage: Database["public"]["Enums"]["forecast_stage"]
          summary: string | null
        }
        Insert: {
          chance_of_impact?: number | null
          change_tag: Database["public"]["Enums"]["forecast_change_tag"]
          created_at?: string
          data_sources?: Json
          decision_label?: string | null
          event_id: string
          id?: string
          is_final?: boolean
          main_threat?: string | null
          previous_snapshot_id?: string | null
          stage: Database["public"]["Enums"]["forecast_stage"]
          summary?: string | null
        }
        Update: {
          chance_of_impact?: number | null
          change_tag?: Database["public"]["Enums"]["forecast_change_tag"]
          created_at?: string
          data_sources?: Json
          decision_label?: string | null
          event_id?: string
          id?: string
          is_final?: boolean
          main_threat?: string | null
          previous_snapshot_id?: string | null
          stage?: Database["public"]["Enums"]["forecast_stage"]
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_forecast_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "tracked_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_forecast_snapshots_previous_snapshot_id_fkey"
            columns: ["previous_snapshot_id"]
            isOneToOne: false
            referencedRelation: "event_forecast_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          checked_at: string | null
          confidence: string | null
          current_conditions: string | null
          event_id: string
          id: string
          percentage: number | null
          summary: string | null
          user_id: string
          verdict: string | null
          verdict_sentence: string | null
          verdict_word: string | null
        }
        Insert: {
          checked_at?: string | null
          confidence?: string | null
          current_conditions?: string | null
          event_id: string
          id?: string
          percentage?: number | null
          summary?: string | null
          user_id: string
          verdict?: string | null
          verdict_sentence?: string | null
          verdict_word?: string | null
        }
        Update: {
          checked_at?: string | null
          confidence?: string | null
          current_conditions?: string | null
          event_id?: string
          id?: string
          percentage?: number | null
          summary?: string | null
          user_id?: string
          verdict?: string | null
          verdict_sentence?: string | null
          verdict_word?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "tracked_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          id: string
          language: string | null
          notification_sensitivity: string | null
          onboarding_completed_at: string | null
          quiet_hours_end: number | null
          quiet_hours_start: number | null
        }
        Insert: {
          created_at?: string | null
          id: string
          language?: string | null
          notification_sensitivity?: string | null
          onboarding_completed_at?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          language?: string | null
          notification_sensitivity?: string | null
          onboarding_completed_at?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
        }
        Relationships: []
      }
      saved_places: {
        Row: {
          address: string
          created_at: string | null
          emoji: string | null
          id: string
          lat: number
          lon: number
          nickname: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string | null
          emoji?: string | null
          id?: string
          lat: number
          lon: number
          nickname: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string | null
          emoji?: string | null
          id?: string
          lat?: number
          lon?: number
          nickname?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_places_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_events: {
        Row: {
          address: string
          archived_at: string | null
          created_at: string | null
          current_climate_facts: Json | null
          current_climate_framing: string | null
          current_climate_interpretation: string | null
          current_confidence: string | null
          current_forecast_stage: string | null
          current_maybe_explanation: Json | null
          current_percentage: number | null
          current_summary: string | null
          current_verdict: string | null
          current_verdict_sentence: string | null
          current_verdict_word: string | null
          event_at: string | null
          event_phrase: string | null
          id: string
          is_active: boolean | null
          last_checked_at: string | null
          last_refresh_attempt_at: string | null
          last_significant_change_at: string | null
          lat: number | null
          lon: number | null
          question: string
          resolved_address: string | null
          resolved_lat: number | null
          resolved_lon: number | null
          user_id: string
          user_seen_change_at: string | null
        }
        Insert: {
          address: string
          archived_at?: string | null
          created_at?: string | null
          current_climate_facts?: Json | null
          current_climate_framing?: string | null
          current_climate_interpretation?: string | null
          current_confidence?: string | null
          current_forecast_stage?: string | null
          current_maybe_explanation?: Json | null
          current_percentage?: number | null
          current_summary?: string | null
          current_verdict?: string | null
          current_verdict_sentence?: string | null
          current_verdict_word?: string | null
          event_at?: string | null
          event_phrase?: string | null
          id?: string
          is_active?: boolean | null
          last_checked_at?: string | null
          last_refresh_attempt_at?: string | null
          last_significant_change_at?: string | null
          lat?: number | null
          lon?: number | null
          question: string
          resolved_address?: string | null
          resolved_lat?: number | null
          resolved_lon?: number | null
          user_id: string
          user_seen_change_at?: string | null
        }
        Update: {
          address?: string
          archived_at?: string | null
          created_at?: string | null
          current_climate_facts?: Json | null
          current_climate_framing?: string | null
          current_climate_interpretation?: string | null
          current_confidence?: string | null
          current_forecast_stage?: string | null
          current_maybe_explanation?: Json | null
          current_percentage?: number | null
          current_summary?: string | null
          current_verdict?: string | null
          current_verdict_sentence?: string | null
          current_verdict_word?: string | null
          event_at?: string | null
          event_phrase?: string | null
          id?: string
          is_active?: boolean | null
          last_checked_at?: string | null
          last_refresh_attempt_at?: string | null
          last_significant_change_at?: string | null
          lat?: number | null
          lon?: number | null
          question?: string
          resolved_address?: string | null
          resolved_lat?: number | null
          resolved_lon?: number | null
          user_id?: string
          user_seen_change_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracked_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          body: string
          change_tag: string
          created_at: string
          event_id: string
          id: string
          read: boolean
          stage: string
          title: string
          user_id: string
        }
        Insert: {
          body: string
          change_tag: string
          created_at?: string
          event_id: string
          id?: string
          read?: boolean
          stage: string
          title: string
          user_id: string
        }
        Update: {
          body?: string
          change_tag?: string
          created_at?: string
          event_id?: string
          id?: string
          read?: boolean
          stage?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      forecast_change_tag:
        | "INITIAL"
        | "STAGE_PROMOTED"
        | "NEW_DATA_SOURCE"
        | "SIGNIFICANT_CHANGE"
        | "MINOR_REFRESH"
        | "RESOLVED_BENIGN"
        | "CONCLUDED"
      forecast_stage:
        | "climate"
        | "outlook"
        | "model_trend"
        | "short_range"
        | "live"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      forecast_change_tag: [
        "INITIAL",
        "STAGE_PROMOTED",
        "NEW_DATA_SOURCE",
        "SIGNIFICANT_CHANGE",
        "MINOR_REFRESH",
        "RESOLVED_BENIGN",
        "CONCLUDED",
      ],
      forecast_stage: [
        "climate",
        "outlook",
        "model_trend",
        "short_range",
        "live",
      ],
    },
  },
} as const
