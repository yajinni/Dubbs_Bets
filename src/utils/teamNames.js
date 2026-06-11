// Display-only name shortening — never use for DB writes or API comparisons
const TEAM_NAME_SHORT = {
  'Democratic Republic of the Congo': 'DR Congo',
  'Bosnia and Herzegovina': 'Bosnia',
};

export function shortenTeamName(name) {
  if (!name) return name;
  return TEAM_NAME_SHORT[name] ?? name;
}
