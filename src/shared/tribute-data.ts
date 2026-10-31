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
const picardWiki = { title: "Wikipedia: Jean-Luc Picard", url: "https://en.wikipedia.org/wiki/Jean-Luc_Picard" };
const stewartWiki = { title: "Wikipedia: Patrick Stewart", url: "https://en.wikipedia.org/wiki/Patrick_Stewart" };
const measure = {
  title: "Wikipedia: The Measure of a Man",
  url: "https://en.wikipedia.org/wiki/The_Measure_of_a_Man_(Star_Trek:_The_Next_Generation)",
};
const tapestry = {
  title: "Wikipedia: Tapestry",
  url: "https://en.wikipedia.org/wiki/Tapestry_(Star_Trek:_The_Next_Generation)",
};
const family = {
  title: "Wikipedia: Family",
  url: "https://en.wikipedia.org/wiki/Family_(Star_Trek:_The_Next_Generation)",
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
    id: "stewart-rsc", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Patrick Stewart performed in more than sixty Royal Shakespeare Company productions.",
  },
  {
    id: "picard-la-barre", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: picardWiki,
    text: "Jean-Luc Picard's birthplace is La Barre, France.",
  },
  {
    id: "picard-academy", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: picardWiki,
    text: "Picard failed his first Starfleet Academy entrance examination before later gaining admission.",
  },
  {
    id: "picard-marathon", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: picardWiki,
    text: "Picard was the first first-year cadet to win the Starfleet Academy marathon.",
  },
  {
    id: "picard-stargazer", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: picardWiki,
    text: "Before commanding the Enterprise, Picard served as first officer and then captain of the Stargazer.",
  },
  {
    id: "picard-tea", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: picardWiki,
    text: "Earl Grey tea is one of Picard's recurring preferences.",
  },
  {
    id: "picard-shakespeare", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: picardWiki,
    text: "Picard enjoys Shakespeare and performs his work in holodeck simulations.",
  },
  {
    id: "picard-riding", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: picardWiki,
    text: "Horse riding is among Picard's interests away from the captain's chair.",
  },
  {
    id: "picard-data-hearing", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: measure,
    text: "In The Measure of a Man, Picard represents Data in a hearing over his right to choose.",
    story: "In The Measure of a Man, a scientist wants to dismantle Data for research. Picard defends Data's right to refuse, while Riker is required to argue the opposing case. The hearing asks whether Starfleet can treat Data as property. The ruling gives Data the right to choose, and he declines the procedure.",
  },
  {
    id: "picard-tapestry", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: tapestry,
    text: "In Tapestry, Picard explores how changing a regretted event could change his whole career.",
    story: "In Tapestry, Q offers Picard a chance to change a decision from his youth. Avoiding the dangerous event produces a safer but very different career: Picard is no longer captain. He chooses to restore the original course of his life. When he wakes in sickbay, he is unsure whether the experience was real or a dream.",
  },
  {
    id: "picard-family-return", subject: "Picard", provenance: "screen", verified: "2026-10-31", source: family,
    text: "In Family, Picard visits the vineyard run by his brother Robert after the Borg encounter.",
    story: "In Family, Picard returns to his family's vineyard while recovering from Borg assimilation. An argument with his brother Robert gives way to a painful admission of what the experience cost him. Picard considers staying on Earth, but ultimately returns to the Enterprise. The episode gives the captain space to recover rather than presenting an immediate return to normal.",
  },
  {
    id: "stewart-mirfield", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Patrick Stewart came from Mirfield in Yorkshire.",
  },
  {
    id: "stewart-bristol", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Patrick Stewart trained at the Bristol Old Vic Theatre School.",
  },
  {
    id: "stewart-teacher", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Stewart credited his teacher Cecil Dormand with introducing him to performing Shakespeare.",
    story: "Patrick Stewart traced an important part of his acting beginnings to an English teacher, Cecil Dormand. Rather than leaving Shakespeare on the page, the teacher encouraged him to perform it. Stewart continued studying drama and later trained at the Bristol Old Vic Theatre School. His Shakespeare work began long before the Enterprise.",
  },
  {
    id: "stewart-reporter", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Before his acting career, Stewart worked briefly as a local newspaper reporter and obituary writer.",
    story: "Before becoming an established actor, Patrick Stewart worked for a local newspaper while pursuing theatre. His employer eventually required him to choose between journalism and acting. Stewart chose the stage. It was an early career decision made before Star Trek or his later screen fame.",
  },
  {
    id: "stewart-dune", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Patrick Stewart played Gurney Halleck in David Lynch's Dune.",
  },
  {
    id: "stewart-claudius", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Patrick Stewart played Sejanus in the television series I, Claudius.",
  },
  {
    id: "stewart-excalibur", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Patrick Stewart played King Leondegrance in Excalibur.",
  },
  {
    id: "stewart-godot", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Stewart and Ian McKellen performed together in Waiting for Godot and No Man's Land.",
    story: "Patrick Stewart and Ian McKellen took their stage partnership beyond their screen roles. They performed Waiting for Godot and No Man's Land in repertory, bringing the productions to both the West End and Broadway. Audiences could see the same two actors working together across two very different plays.",
  },
  {
    id: "stewart-macbeth", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Stewart's Broadway performance as Macbeth earned a Tony Award nomination.",
  },
  {
    id: "stewart-animation", subject: "Patrick Stewart", provenance: "career", verified: "2026-10-31", source: stewartWiki,
    text: "Stewart's animated-film voice work includes The Pagemaster, The Prince of Egypt and Jimmy Neutron: Boy Genius.",
  },
];
