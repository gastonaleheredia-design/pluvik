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
      answer_feedback: {
        Row: {
          address: string | null
          created_at: string
          event_question: string | null
          feedback: string
          id: string
          lat: number | null
          lon: number | null
          percentage: number | null
          user_id: string | null
          verdict: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          event_question?: string | null
          feedback: string
          id?: string
          lat?: number | null
          lon?: number | null
          percentage?: number | null
          user_id?: string | null
          verdict?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          event_question?: string | null
          feedback?: string
          id?: string
          lat?: number | null
          lon?: number | null
          percentage?: number | null
          user_id?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          label: string | null
          last_used_at: string | null
          request_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          label?: string | null
          last_used_at?: string | null
          request_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          label?: string | null
          last_used_at?: string | null
          request_count?: number
          user_id?: string
        }
        Relationships: []
      }
      business_profiles: {
        Row: {
          business_name: string
          created_at: string
          id: string
          industry: string
          owner_user_id: string
        }
        Insert: {
          business_name: string
          created_at?: string
          id?: string
          industry: string
          owner_user_id: string
        }
        Update: {
          business_name?: string
          created_at?: string
          id?: string
          industry?: string
          owner_user_id?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          accepted_at: string | null
          company_id: string
          id: string
          invited_email: string | null
          role: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          id?: string
          invited_email?: string | null
          role?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          id?: string
          invited_email?: string | null
          role?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "company_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          company_name: string
          created_at: string
          id: string
          industry: string | null
          logo_url: string | null
          owner_user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          id?: string
          industry?: string | null
          logo_url?: string | null
          owner_user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          id?: string
          industry?: string | null
          logo_url?: string | null
          owner_user_id?: string
        }
        Relationships: []
      }
      company_teams: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_teams_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_comments: {
        Row: {
          created_at: string
          event_id: string
          id: string
          is_anonymous: boolean
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          is_anonymous?: boolean
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          is_anonymous?: boolean
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_comments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "weather_events"
            referencedColumns: ["id"]
          },
        ]
      }
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
      event_participants: {
        Row: {
          event_id: string
          id: string
          is_anonymous: boolean
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          event_id: string
          id?: string
          is_anonymous?: boolean
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          event_id?: string
          id?: string
          is_anonymous?: boolean
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "weather_events"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: []
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
          monthly_question_count: number
          notification_sensitivity: string | null
          onboarding_completed_at: string | null
          onesignal_player_id: string | null
          question_count_reset_at: string
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          subscription_tier: string
        }
        Insert: {
          created_at?: string | null
          id: string
          language?: string | null
          monthly_question_count?: number
          notification_sensitivity?: string | null
          onboarding_completed_at?: string | null
          onesignal_player_id?: string | null
          question_count_reset_at?: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          subscription_tier?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          language?: string | null
          monthly_question_count?: number
          notification_sensitivity?: string | null
          onboarding_completed_at?: string | null
          onesignal_player_id?: string | null
          question_count_reset_at?: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          subscription_tier?: string
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
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          accepted_at: string | null
          business_id: string
          created_at: string
          id: string
          invited_email: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          business_id: string
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          business_id?: string
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
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
          current_mode: string | null
          current_percentage: number | null
          current_summary: string | null
          current_verdict: string | null
          current_verdict_sentence: string | null
          current_verdict_word: string | null
          event_at: string | null
          event_phrase: string | null
          event_title: string | null
          final_forecast_sentence: string | null
          final_forecast_stage: string | null
          final_forecast_verdict: string | null
          id: string
          is_active: boolean | null
          last_checked_at: string | null
          last_notified_at: string | null
          last_refresh_attempt_at: string | null
          last_significant_change_at: string | null
          lat: number | null
          lon: number | null
          next_refresh_at: string | null
          outcome_recorded: boolean
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
          current_mode?: string | null
          current_percentage?: number | null
          current_summary?: string | null
          current_verdict?: string | null
          current_verdict_sentence?: string | null
          current_verdict_word?: string | null
          event_at?: string | null
          event_phrase?: string | null
          event_title?: string | null
          final_forecast_sentence?: string | null
          final_forecast_stage?: string | null
          final_forecast_verdict?: string | null
          id?: string
          is_active?: boolean | null
          last_checked_at?: string | null
          last_notified_at?: string | null
          last_refresh_attempt_at?: string | null
          last_significant_change_at?: string | null
          lat?: number | null
          lon?: number | null
          next_refresh_at?: string | null
          outcome_recorded?: boolean
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
          current_mode?: string | null
          current_percentage?: number | null
          current_summary?: string | null
          current_verdict?: string | null
          current_verdict_sentence?: string | null
          current_verdict_word?: string | null
          event_at?: string | null
          event_phrase?: string | null
          event_title?: string | null
          final_forecast_sentence?: string | null
          final_forecast_stage?: string | null
          final_forecast_verdict?: string | null
          id?: string
          is_active?: boolean | null
          last_checked_at?: string | null
          last_notified_at?: string | null
          last_refresh_attempt_at?: string | null
          last_significant_change_at?: string | null
          lat?: number | null
          lon?: number | null
          next_refresh_at?: string | null
          outcome_recorded?: boolean
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
          change_tag: string | null
          created_at: string
          event_id: string | null
          id: string
          read: boolean
          stage: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          change_tag?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          read?: boolean
          stage?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          change_tag?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          read?: boolean
          stage?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "tracked_events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          daily_question_count: number
          display_name: string | null
          id: string
          last_question_date: string | null
          tier: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          daily_question_count?: number
          display_name?: string | null
          id: string
          last_question_date?: string | null
          tier?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          daily_question_count?: number
          display_name?: string | null
          id?: string
          last_question_date?: string | null
          tier?: string
          username?: string
        }
        Relationships: []
      }
      weather_events: {
        Row: {
          activity_type: string | null
          company_id: string | null
          confidence: string | null
          created_at: string
          creator_id: string
          event_date: string | null
          event_end: string | null
          forecast_stage: string | null
          id: string
          lat: number | null
          location_label: string | null
          lon: number | null
          question: string | null
          status: string
          status_message: string | null
          status_set_at: string | null
          team_ids: string[] | null
          title: string | null
          verdict: string | null
        }
        Insert: {
          activity_type?: string | null
          company_id?: string | null
          confidence?: string | null
          created_at?: string
          creator_id: string
          event_date?: string | null
          event_end?: string | null
          forecast_stage?: string | null
          id?: string
          lat?: number | null
          location_label?: string | null
          lon?: number | null
          question?: string | null
          status?: string
          status_message?: string | null
          status_set_at?: string | null
          team_ids?: string[] | null
          title?: string | null
          verdict?: string | null
        }
        Update: {
          activity_type?: string | null
          company_id?: string | null
          confidence?: string | null
          created_at?: string
          creator_id?: string
          event_date?: string | null
          event_end?: string | null
          forecast_stage?: string | null
          id?: string
          lat?: number | null
          location_label?: string | null
          lon?: number | null
          question?: string | null
          status?: string
          status_message?: string | null
          status_set_at?: string | null
          team_ids?: string[] | null
          title?: string | null
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weather_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_reset_final_snapshot: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      get_team_tracked_events: {
        Args: never
        Returns: {
          address: string
          archived_at: string
          asker_email: string
          business_id: string
          business_name: string
          created_at: string
          current_forecast_stage: string
          current_verdict_sentence: string
          current_verdict_word: string
          event_at: string
          id: string
          is_active: boolean
          question: string
          resolved_address: string
          user_id: string
        }[]
      }
      get_user_tier: { Args: { user_id: string }; Returns: string }
      is_business_member: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      is_business_owner: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_admin: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_event_participant: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
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
