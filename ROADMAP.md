# Roadmap
Transferhero is still in an early stage of development, with more features to come.

### Features
- implement persistent user preferences store
- Show platform-level transfer walking directions. Could just be simple instructions for key transfers.
- mobile ui/ux polish
- Multi-leg journey planning (A → B → C). Not sure how useful this is since all lines intersect, but I think there are a handful of trips where this makes sense. Low priority, high effort.
- Service advisories and alerts integration. Should be simple actually via the apis
- Use MetroHero open source algorithm for train time predictions. Not sure how much this would help with accuracy. I think WMATA-RT data uses track positions similar to MetroHero. And gtfs is probably good enough for further out trains.
- destination-based route planning. Would defintiely require additional API use to some kind of mapping api to determine which station is closest. Complex but a lot of people would like this feature.

- optimize graph traversal for interlined segments (e.g. vienna/largo)