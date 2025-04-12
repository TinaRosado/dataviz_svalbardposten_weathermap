# Svalbardposten's Weather Map: A First Concept Develompent
### Navigating Media Discourse through Network Maps

This project is a component of a broader Master of Fine Arts thesis in Information Design and Data Visualization at Northeastern University. The thesis employs a Cultural Analytics approach (Manovich 2020) to examine the visualization challenges of large digital archives, using Svalbardposten’s digital news archive as a case study. It explores and compares two distinct computational approaches and visualization techniques, analyzing their outcomes through the lens of Cultural Analytics principles. The results of the computational approaches and the visualizations of the study are intended as a concepetualization experiment and are not the intended final outcomes. Further refinement of the computationsl The study's exploratory nature

The goal of this repository is to document methodologies used to visualize the newspaper archive through the implementation of [Rodighiero and Daniélou’s Weather Map (2024)](https://pure.rug.nl/ws/portalfiles/portal/856541881/10.1515_9783111317779-017.pdf) and making them openly accessible. This ensures that the computational analysis underpinning the visualization is transparent and reproducible, allowing other researchers to explore, adapt, and build upon this work.




## DATA

This research marks the first computational exploration of Svalbardposten's digital archive, a significant resource for understanding local journalism in one of the world's northernmost permanently inhabited regions. Svalbardposten, established in 1948, started as a community paper to broadcast information about the coal mining activities and relevant notifications. Currently it serves as the primary news source for Svalbard's international community, with coverage focusing on community activities, cultural and historical news, local politics, environmental issues, tourism, scientific research, and the region's unique regulatory framework under the Svalbard Treaty.

This study presents the first computational exploration of the Svalbardposten digital archive, comprising 16,786 articles with associated metadata spanning from 2006 to 2024. Svalbardposten provided URL access to their RSS feed and a list of unique IDs in Excel format for research purposes. Data was collected programmatically through the HTTPS protocol using Python code to access the newspaper's RSS feed and retrieve articles via their unique IDs. While metadata and analytical results are presented in this research, the full article texts remain proprietary and are not publicly distributed.

### Table 1: Data Sample of *Svalbardposten*’s Born-Digital Archive

| Column Header             | Sample                                                                                                                                  |
|---------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `bodytext`                | I starten av onsdagens lokalstyremøte stilte Gytri spørsmål til administrasjonen på vegne av listesamarbeidet Venstre/Høyre. Det er en oppfølging fra fjorårets budsjettmøte… |
| `contentMarketingPublisher` | type                                                                                                                                |
| `created`                 | 2024-09-20T10:08:40+02:00                                                                                                               |
| `created_by_name`         | Kristiansen, Martin                                                                                                                    |
| `id`                      | 545658                                                                                                                                  |
| `published`               | 2024-09-20T12:17:59+02:00                                                                                                               |
| `published_url`           | /stiller-sporsmal-om-kommunokonomien/545658                                                                                            |
| `subtitle`                | – Longyearbyen lokalstyre må gjøre en grundig vurdering av hva det brukes penger på, og vi er opptatt av en bred gjennomgang for å få en god oversikt. Det understreker Jo Gytri i Svalbard Høyre. |
| `summary_shot_title`      | N/A                                                                                                                                     |
| `tags`                    | nyheter, lokalstyret, idrett, kultur                                                                                                    |
| `title`                   | Stiller spørsmål om kommunøkonomien                                                                                                     |
| `type`                    | article                                                                                                                                 |

---

## Implementation: Actor-Network Analysis (Weather Map)

The first analytical approach adapts **Rodighiero and Daniélou's Weather Map** (Rodighiero and Daniélou 2023) to examine the evolution of actors and discourse in *Svalbardposten*'s reporting. The Weather Map was conceived as a tool to examine public debate and is inspired by **Bruno Latour's Actor-Network Theory** (Latour 2005). It is an innovative approach to mapping public discourse using **weather patterns as a time-based metaphor**, with documents clustered based on the prominence of key actors and trends in newspaper mentions over time.

The analysis and visualization process follows five main steps:

---

### **STEP 1 – Entity Extraction**

Entity extraction is performed by identifying syntactic elements using **Parts of Speech (POS)** and semantic categories using **Named Entity Recognition (NER)**, implemented with **SpaCy** and the model `'nb_core_news_sm'`.

- Extracted elements include: nouns, proper nouns, and organizations functioning as actors within the discourse network.
- Verbs, adjectives, symbols, and numbers are excluded from this step.
- The process includes tokenization and lemmatization.
- **Norwegian language terms are preserved** to maintain semantic fidelity.

---

### **STEP 2 – Network Construction and Clustering**

Entities are clustered based on frequency and co-occurrence using:

- **TF-IDF vectorization** (Spärck Jones 1972)
- **UMAP** (Uniform Manifold Approximation and Projection; McInnes et al. 2018) for dimensionality reduction
- **HDBSCAN** for density-based clustering of co-occurring entities

Clusters represent key thematic areas in the discourse. Outliers with unassigned clusters are grouped into **cluster `-1`**, though they may lack substantive semantic commonality.

---

### **STEP 3 – Temporal Analysis Integration**

To visualize discourse evolution:

- A **color temperature gradient** encodes time:
  - Cool hues (blue) for earlier years
  - Warm hues (red) for recent years
- The archive is split into two temporal segments to highlight shifts in discourse over time.

This diachronic dimension helps track **the changing prominence of topics and actors**.

---

### **STEP 4 – Prompt-Engineering Topic Labeling**

This step enhances interpretability of clusters using **OpenAI’s GPT-4** via a prompt-engineering strategy:

1. **Top keywords** from each cluster (based on POS and NER data) are extracted.
2. A structured prompt is crafted with:
   - Requests for **2–3 word English labels**
   - Instructions to avoid generic or redundant terms
   - Emphasis on **Svalbard-specific domain knowledge**
   - Translation from Norwegian to English
3. **Manual verification** ensures semantic and contextual accuracy.

This **human-in-the-loop** approach (Munk et al., 2024) ensures meaningful, reliable cluster labels.

---

### **STEP 5 – Interactive Interface Visualization**

Code adapted from Rodighiero’s GitHub repository:  
[https://github.com/TinaRosado/dataviz_svalbardposten_weathermap](https://github.com/TinaRosado/dataviz_svalbardposten_weathermap)

The JavaScript visualization includes:

- **Zooming functionality** for distant/close reading of the discourse
- **Color overlays**:
  - Overlapping red/blue clusters highlight enduring themes
- **Isoline boundaries** to differentiate clusters
- **English translations** of topic labels and key metadata
- **Direct links** to original *Svalbardposten* articles

The *Svalbardposten* Weather Map offers structured, interactive access to the archive, enabling exploration of **how Longyearbyen’s news media discourse has evolved** over time and which themes have remained central.