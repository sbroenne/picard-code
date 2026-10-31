export interface TributeEntry {
  id: string;
  subject: "Picard" | "Patrick Stewart";
  text: string;
  provenance: "screen" | "career" | "production";
  source: { title: string; url: string };
  verified: string;
  story?: string;
}

const museum = {
  title: "StarTrek.com: Connecting the Galaxy With Its Past",
  url: "https://www.startrek.com/en-un/news/connecting-the-galaxy-with-its-past",
};
const innerLight = {
  title: "StarTrek.com: Preserving Our Inner Light",
  url: "https://www.startrek.com/en-un/news/trek-class-preserving-our-inner-light",
};
const darmok = {
  title: "StarTrek.com: Picard and Dathon at El-Adrel... Forever",
  url: "https://www.startrek.com/en-un/news/picard-and-dathon-at-el-adrel-forever",
};
const memoir = {
  title: "Simon & Schuster: Making It So",
  url: "https://www.simonandschuster.com/books/Making-It-So/Patrick-Stewart/9781982167745",
};
const christmas = {
  title: "London Theatre: A Christmas Carol with Patrick Stewart",
  url: "https://www.londontheatre.co.uk/theatre-news/news/a-christmas-carol-with-patrick-stewart",
};

// Original summaries of individually checked public career and story facts, not script or book excerpts.
export const TRIBUTE_ENTRIES: readonly TributeEntry[] = [
  {
    id: "picard-artifacts", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: museum,
    text: "Picard's interest in archaeology includes collecting ancient artifacts.",
  },
  {
    id: "picard-phoenix", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: museum,
    text: "In First Contact, Picard gets to touch the Phoenix, a ship he had previously seen at the Smithsonian.",
    story: "In First Contact, Picard encounters the Phoenix outside a museum. He knows the historic ship from visits to the Smithsonian, where touching it was not allowed. Now he can place a hand on its hull. The moment connects the captain's interest in the past with a real object from that past.",
  },
  {
    id: "picard-kamin", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: innerLight,
    text: "In The Inner Light, Picard experiences life on Kataan as a man named Kamin.",
    story: "In The Inner Light, a probe gives Picard the experience of another lifetime on Kataan. As Kamin, he raises a family and learns the flute while the planet faces destruction. He returns to the Enterprise after only twenty minutes, carrying memories of those years and the music he learned. Through him, part of a lost culture survives.",
  },
  {
    id: "picard-twenty-minutes", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: innerLight,
    text: "In The Inner Light, Picard experiences many years of another life while only twenty minutes pass aboard the Enterprise.",
  },
  {
    id: "picard-flute", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: innerLight,
    text: "After The Inner Light, Picard retains the ability to play the flute he learned on Kataan.",
  },
  {
    id: "picard-exhibit", subject: "Picard", provenance: "production", verified: "2026-10-31", source: museum,
    text: "The Jean-Luc Picard: The First Duty exhibit included his flute, a family album prop, and a Tamarian knife.",
  },
  {
    id: "picard-darmok", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: darmok,
    text: "In Darmok, Picard learns to communicate with the Tamarians through the stories behind their language.",
    story: "In Darmok, Picard and the Tamarian captain Dathon cannot understand each other's meaning, even when individual words translate. Facing danger together, Picard discovers that Dathon's language draws on shared stories. Picard answers with the tale of Gilgamesh. After Dathon dies from his injuries, Picard uses what he has learned to communicate with the Tamarian crew.",
  },
  {
    id: "stewart-dickens", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: christmas,
    text: "Patrick Stewart played every character in his one-man stage adaptation of A Christmas Carol.",
    story: "Patrick Stewart staged A Christmas Carol with himself as the entire cast. He moved between Scrooge, Bob Cratchit, Tiny Tim and the other characters, using only a few props. London Theatre records that he also adapted and staged the production. Its account describes a performer creating a whole fictional world rather than relying on a large cast.",
  },
  {
    id: "stewart-olivier", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: christmas,
    text: "Patrick Stewart's solo A Christmas Carol earned an Olivier Award for Best Entertainment.",
    story: "Patrick Stewart's one-man A Christmas Carol reached audiences on both sides of the Atlantic. London Theatre records three New York seasons and a 1993 Old Vic run in London. The production earned him an Olivier Award for Best Entertainment and a Drama Desk award for acting. It is a stage achievement separate from his work as Captain Picard.",
  },
  {
    id: "stewart-xavier", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: memoir,
    text: "Patrick Stewart's screen roles include both Jean-Luc Picard and Professor Charles Xavier in X-Men.",
  },
  {
    id: "stewart-memoir", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: memoir,
    text: "Patrick Stewart's memoir is called Making It So, and he narrated its audiobook himself.",
    story: "Patrick Stewart brought his career to the page in the memoir Making It So and also narrated the audiobook. The publisher describes work ranging from the Royal Shakespeare Company to Picard, Professor Xavier, and comedy. The book brings those different parts of his acting career together; it is about Stewart, not the fictional life of Picard.",
  },
  {
    id: "stewart-comedy", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: memoir,
    text: "Patrick Stewart's comedy work includes American Dad!, Extras, and Blunt Talk.",
  },
  {
    id: "stewart-rsc", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: memoir,
    text: "Patrick Stewart's career includes more than forty years with the Royal Shakespeare Company.",
  },
];
