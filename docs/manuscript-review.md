# Review the current manuscript

Save and compile the selected manuscript, then choose **Review current PDF**.
Archimedes checks the saved source and PDF bytes before preparing a separate
simulated-review run. Unsaved edits, changed section or bibliography files, or
an old build require another compilation. The source receipt records the
main/source file, project, execution folder, source version and PDF hash.

The review page shows the prepared source and offers **Return to source
manuscript**. Starting the review binds that receipt to the actual generated
review run ID. The retained input stays available as later previews are
compiled. Deleting a review releases only that run's retention reference;
cancelling keeps its historical input. A failed run creation rolls back its
retention reference. Existing
review history without a manuscript receipt remains readable; it does not
gain an invented source association.

In a completed review, **Add to revision draft** sends the selected finding,
its quoted evidence/page, the reviewed source version and PDF hash to a
separate manuscript revision discussion. It preserves the original research
conversation's unsent draft and does not start an agent task automatically.
Additional findings append to that manuscript's revision discussion. The user
can compare the current sources with the reviewed version before requesting
specific changes.
