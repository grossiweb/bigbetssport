/**
 * GraphQL SDL for the Big Ball Sports public API.
 *
 * Field resolvers in `resolvers.ts` delegate to `FieldRouter.fetchField`,
 * so the schema mirrors the REST endpoints: Match carries the same set of
 * lazily-resolvable fields (scores, odds, lineups, stats, etc.) and each
 * one surfaces its own `FieldMeta` for provenance.
 */

export const typeDefs = /* GraphQL */ `
  enum MatchStatus {
    scheduled
    live
    finished
    postponed
    cancelled
  }

  type FieldMeta {
    source: String!
    confidence: Float!
    cached: Boolean!
    fetchedAt: String
    via: String
  }

  type Sport {
    slug: String!
    name: String!
  }

  type League {
    id: ID!
    name: String!
    sport: String!
    country: String
  }

  type Team {
    id: ID!
    name: String!
    sport: String!
  }

  type Player {
    id: ID!
    name: String!
    sport: String!
    position: String
  }

  type ScoreData {
    raw: JSON
    meta: FieldMeta!
  }

  type OddsLine {
    raw: JSON
    meta: FieldMeta!
  }

  type LineupsData {
    raw: JSON
    meta: FieldMeta!
  }

  type MatchStatsData {
    raw: JSON
    meta: FieldMeta!
  }

  type Match {
    id: ID!
    homeTeam: Team!
    awayTeam: Team!
    kickoffUtc: String!
    status: MatchStatus!
    scores: ScoreData
    odds: [OddsLine!]
    lineups: LineupsData
    stats: MatchStatsData
    meta: FieldMeta!
  }

  type Standing {
    leagueId: String!
    season: Int
    raw: JSON
    meta: FieldMeta!
  }

  type Injury {
    raw: JSON
    meta: FieldMeta!
  }

  scalar JSON

  # --- Cricket extension (P-08) -----------------------------------------

  enum CricketMatchType { TEST ODI T20 T20I LIST_A IPL BBL PSL }

  type CricketMatchState {
    inningsNumber: Int!
    battingTeamId: String!
    oversBowled: Float!
    runsScored: Int!
    wicketsFallen: Int!
    target: Int
    requiredRunRate: Float
    currentRunRate: Float
  }

  type CricketInnings {
    inningsNumber: Int!
    raw: JSON
  }

  type CricketMatch {
    id: ID!
    matchType: CricketMatchType!
    homeTeam: Team!
    awayTeam: Team!
    venue: String
    currentState: CricketMatchState
    innings: [CricketInnings!]!
  }

  # --- Combat-sport extension (P-08) ------------------------------------

  enum WeightClass {
    STRAWWEIGHT
    FLYWEIGHT
    BANTAMWEIGHT
    FEATHERWEIGHT
    LIGHTWEIGHT
    WELTERWEIGHT
    MIDDLEWEIGHT
    LIGHT_HEAVYWEIGHT
    HEAVYWEIGHT
    UNKNOWN
  }

  type CombatAthlete {
    id: ID!
    name: String!
    record: String
    recordWins: Int!
    recordLosses: Int!
    recordDraws: Int!
    recordNc: Int!
    nationality: String
    stance: String
    weightClass: WeightClass
  }

  type FightResult {
    method: String!
    round: Int
    time: String
    winnerId: ID
  }

  type MmaBout {
    id: ID!
    card: FightCard!
    fighterA: CombatAthlete!
    fighterB: CombatAthlete!
    weightClass: WeightClass!
    result: FightResult
  }

  type BoxingBout {
    id: ID!
    card: FightCard!
    fighterA: CombatAthlete!
    fighterB: CombatAthlete!
    weightClass: WeightClass!
    sanctioningBody: String
    result: FightResult
  }

  type FightCard {
    id: ID!
    eventName: String!
    eventDate: String!
    promoter: String
    bouts: [MmaBout!]!
  }

  type Query {
    sports: [Sport!]!
    match(id: ID!, sport: String!, fields: [String!]): Match
    matches(sport: String!, league: String, date: String, status: String): [Match!]
    player(id: ID!, sport: String!): Player
    standings(league: String!, season: Int): [Standing!]

    # P-08 queries — resolver stubs until the storage layer ships.
    cricketMatch(id: ID!): CricketMatch
    fightCard(id: ID!, sport: String!): FightCard
    mmaBout(id: ID!): MmaBout
    boxingBout(id: ID!): BoxingBout
    athlete(id: ID!): CombatAthlete
  }

  type Subscription {
    matchUpdated(matchId: ID!): Match
    liveScores(sport: String!): [Match!]
  }
`;
