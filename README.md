# Svalbardposten's Weather Map
## A First Concept Develompent

<br/>

### Quick links to sections of the README file

[Introduction](#Introduction)

[Data](#Data)

[Methodology](#Methodology)

[Contribution & Future Work](#Contribution_&_Future_Work)

<br/>
<br/>
<br/>

## Introduction

<br/>


### Navigating Media Discourse through Network Maps

This project is a component of a broader Master of Fine Arts thesis in Information Design and Data Visualization at Northeastern University. The thesis employs a Cultural Analytics approach to examine the visualization challenges of large digital archives, using Svalbardposten’s digital news archive as a case study. It explores and compares two distinct computational approaches and visualization techniques, analyzing their outcomes through the lens of Cultural Analytics principles. The results of the computational approaches and the visualizations of the study are intended as a concepetualization experiment and are not the intended final outcomes. Further refinement of the computationsl The study's exploratory nature

It is important to note that the scope of this thesis—and by extension, this project—is exploratory in nature. Its primary aim is to ideate and prototype possible interactive interfaces that facilitate access to large digital archives. As such, the analytical and visualization processes presented here should be understood as preliminary and experimental. They are not intended to represent a final or comprehensive analysis but rather to serve as a foundation for future iterations, encouraging continued refinement, expansion, and exploration through computational methods. 

The goal of this repository is to document methodologies used to visualize the newspaper archive through the implementation of [Rodighiero and Daniélou’s Weather Map (2023)](https://pure.rug.nl/ws/portalfiles/portal/856541881/10.1515_9783111317779-017.pdf) and making them openly accessible. This ensures that the computational analysis underpinning the visualization is transparent and reproducible, allowing other researchers to explore, adapt, and build upon this work.


<br/>

### Audience

This project is intended for students and practitioners in the Digital Humanities, Information Design, and Data Science that are interested in mapping large collections of text based documents through a web-based interactive interface. 

<br/>

### Repository Structure

This repository contains all the code and files necessary for running the data analysis and deploying the interactive interface. It is organized into three main folders, each serving a distinct role in the workflow:

| Folder     | Description                                                                                                                                                                                                 |
|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `data`     | **Computational Analysis**: Contains the Jupyter Notebook for NLP-based computational analysis, with step-by-step code, descriptive annotations, and graphical visualizations. It also generates the CSV file used as input for the web interface. |
| `docs`     | **Production-Ready JavaScript for Web Deployment**: Contains production-ready JavaScript files for the web application, generated using Webpack, which compiles and optimizes the code (JavaScript, CSS, and other assets) for browser deployment. |
| `src`      | **Files to Build Interface**: Contains the application's source code, including JavaScript modules, CSS assets, and the CSV file generated during data analysis. These files define the structure, interactivity, and presentation of the web interface. |

#### Visualization URL

You can view the interactive visualization at the following link:  
[Interactive Visualization](https://tinarosado.github.io/dataviz_svalbardposten_weathermap/)


<br/>
<br/>
<br/>

## DATA

This research marks the first computational exploration of Svalbardposten's digital archive, a significant resource for understanding local journalism in one of the world's northernmost permanently inhabited regions. Svalbardposten, established in 1948, started as a community paper to broadcast information about the coal mining activities and relevant notifications. Currently it serves as the primary news source for Svalbard's international community, with coverage focusing on community activities, cultural and historical news, local politics, environmental issues, tourism, scientific research, and the region's unique regulatory framework under the Svalbard Treaty.

This study presents the first computational exploration of the Svalbardposten digital archive, comprising 16,786 articles with associated metadata spanning from 2006 to 2024. Svalbardposten provided URL access to their RSS feed and a list of unique IDs in Excel format for research purposes. Data was collected programmatically through the HTTPS protocol using Python code to access the newspaper's RSS feed and retrieve articles via their unique IDs. While metadata and analytical results are presented in this research, the full article texts remain proprietary and are not publicly distributed.

#### Table 1: Data Sample of *Svalbardposten*’s Digital Archive

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

<br/>
<br/>
<br/>

## Methodology
<br/>

### Implementation: Actor-Network Analysis (Weather Map)

Code adapted from [Rodighiero’s GitHub repository](https://github.com/rodighiero/weather-map)

This analysis adapts **Rodighiero and Daniélou's Weather Map** (Rodighiero and Daniélou 2023) to examine the evolution of actors and discourse in *Svalbardposten*'s reporting. The Weather Map was conceived as a tool to examine public debate and is inspired by **Bruno Latour's Actor-Network Theory**. It is an innovative approach to mapping public discourse using **weather patterns as a time-based metaphor**, with documents clustered based on the prominence of key actors and trends in newspaper mentions over time.

The analysis and visualization process of this project follows five main steps:


<br/>

#### **STEP 1 – Entity Extraction**

Entity extraction is performed by identifying syntactic elements within the text using Parts of Speech (POS) and identifying semantic categories using Named Entity Recognition (NER). Both processes are implemented using the SpaCy and the model 'nb_core_news_sm'. This computational linguistics approach enables the systematic identification of relevant subjects within the articles, including nouns, proper nouns, and organizations that function as actors within the discourse network. For the purposes of this analysis, actors are defined as subjects within the discourse therefore verbs, adjectives symbols and numbers were not extracted in this step. The extraction process includes tokenization and lemmatization and preserves the original Norwegian language terms to maintain semantic fidelity throughout the analysis.


<br/>

#### **STEP 2 – Network Construction and Clustering**

Once entities are extracted, they are clustered based on frequency and co-occurrence utilizing Term Frequency-Inverse Document Frequency (TF-IDF)(Spärck Jones 1972) vectorization.  Following vectorization of the entities,, Uniform Manifold Approximation and Projection (UMAP)(McInnes, Healy, and Melville 2018) is applied for dimensionality reduction, which projects the high-dimensional relationship data onto a two-dimensional Cartesian space while preserving the topological structure of the data. With the data projected in two dimensions, clustering is performed using Hierarchical Density-Based Spatial Clustering of Applications with Noise (HDBSCAN). This density-based clustering algorithm groups entities that frequently appear together in the corpus, enabling the identification of key thematic clusters within the discourse based on actors' close relationships. It is important to note that this approach does not necessarily assign every document to a meaningful cluster; a subset of outliers with unassigned clusters are grouped into a single cluster (cluster -1) despite lacking substantive semantic commonality amongst them. 


<br/>

#### **STEP 3 – Temporal Analysis Integration**

To capture the temporal evolution of the discourse, the analysis incorporates a diachronic dimension by color mapping time across the archive’s years. A color temperature gradient is implemented as a visual encoding strategy, where cooler hues (blue spectrum) are mapped to earlier temporal periods, using the earliest year as one end of the spectrum, and warmer hues (red spectrum) denote more recent occurrences, using the final year as the other end of the spectrum. In addition the time frame is divided in two, and used as a reference later in the visualization to denote major areas of past and recent discourse. The integration of this temporal dimension enables the investigation of research questions concerning the evolving significance of specific topics and actors.


<br/>

#### **STEP 4 – Prompt-Engineering Topic Labeling**

The Svalbardposten adaptation of the Weather Map has an additional step to systematically interpret and label topics for each cluster identified in the previous step. Using OpenAI APIs, the labeling process employs a large language model (GPT-4). Giving the model an assigned role as a domain expert in text analysis, in Norwegian language and Svalbard contexts. The process involves:


1. **Top keywords** from each cluster (based on POS and NER data) are extracted.
2. A structured prompt is crafted with:
   - Requests for **2–3 word English labels**
   - Instructions to avoid generic or redundant terms
   - Emphasis on **Svalbard-specific domain knowledge**
   - Translation from Norwegian to English
3. **Manual verification** ensures semantic and contextual accuracy.

This **human-in-the-loop** approach ensures meaningful, reliable cluster labels.


<br/>

#### **STEP 5 – Interactive Interface Visualization**

The design of the final JavaScript visualization was adopted from code provided by Rodighiero and lightly adapted to adjust the legend and a few visual elements for readability. The visualization displays entity clusters and their relationships through an interactive web-based interface with specific visual affordances and navigation capabilities:

- **Zooming functionality** for distant/close reading of the discourse
- **Color overlays**:
  - Overlapping red/blue clusters highlight enduring themes
- **Isoline boundaries** to differentiate clusters
- **English translations** of topic labels and key metadata
- **Direct links** to original *Svalbardposten* articles

The *Svalbardposten* Weather Map offers structured, interactive access to the archive, enabling exploration of **how Longyearbyen’s news media discourse has evolved** over time and which themes have remained central.

<br/>
<br/>
<br/>

## Contribution & Future Work


This project successfully created a public-facing repository that includes both the computational analysis and an interactive visualization of *Svalbardposten*’s digital news archive (2006–2024). A core priority throughout the process was maintaining the privacy of the full article texts while ensuring transparency in the computational methodology and its outputs.

Detailed analytical results and interface implementation are documented in the Northeastern MFA thesis *An Atlas of Discourse: Navigating Large Digital Archives through Visual Maps* (link to be available upon publication by the Northeastern Library).

#### Methodological Contributions

This project makes several methodological contributions to the field of Digital Humanities:

- **Adaptation of the Weather Map to Journalistic Archives**  
  This implementation demonstrates the versatility of the Weather Map visualization technique beyond its original use in controversy mapping and manuscript analysis. By adapting it to a longitudinal news archive, the project offers a scalable model for applying this method to other journalistic or cultural collections.

- **Topic Labeling Application**  
  The integration of prompt-engineered topic labeling adds an innovative dimension to the original Weather Map methodology. This human-in-the-loop approach combines computational clustering with the interpretive capabilities of large language models, resulting in more meaningful and accessible thematic navigation.

- **Multilingual Considerations**  
  The project addresses the challenges of analyzing Norwegian-language text using natural language processing (NLP) tools, documenting specific adaptations that could inform future work with non-English corpora.

- **Reproducibility Framework**  
  The GitHub repository, structured into three folders—`data analysis`, `source code`, and `production-ready files`—provides a transparent and reproducible framework. This modular structure supports both technical clarity and practical reuse for future projects.

#### Directions for Future Research

Despite its contributions, this first iteration of the *Svalbardposten* Weather Map has several limitations that suggest directions for future research:

- **Temporal Resolution of Topic Evolution**  
  While the visualization effectively captures broad shifts in discourse (e.g., early vs. late periods), not all articles could be confidently classified into thematic clusters, limiting the resolution of topic evolution across the full archive. Further refinement of the computational process can improve this outcome.

- **Multilingual Integration**  
  Currently, the implementation focuses exclusively on Norwegian-language articles. Future iterations should incorporate multilingual analysis to capture the full linguistic and cultural diversity of *Svalbardposten*’s coverage.

- **User Testing and Evaluation**  
  Formal usability testing with both scholarly and non-scholarly users would provide insight into how different audiences interact with the visualization. Such evaluation would help refine the design for broader accessibility and interpretability, as identified in Section 1.4.

- **Expanded Metadata**  
  Incorporating metadata such as article length, section placement, or associated multimedia could enrich the visualization and reveal new dimensions of the newspaper’s editorial strategies. These possibilities are explored further in the second approach presented in the thesis.

- **Towards Exploratory Interfaces**  
  A critical area for future exploration lies in expanding the interface to not only guide users through the archive but to engage them as active participants in the process of knowledge-creation. This shift—from passive exploration to interpretive collaboration—could transform how users interact with large-scale digital archives, opening new pathways for critical inquiry, cultural reflection, and collective memory-making.
