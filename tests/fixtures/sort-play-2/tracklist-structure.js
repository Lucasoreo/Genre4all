  function updateTracklistStructure(tracklist_) {
    const currentUri = getCurrentUri();
    const isSearch = Spicetify.Platform.History.location?.pathname?.startsWith('/search');
    
    const isValidPlaylistPage = currentUri && (URI.isPlaylistV1OrV2(currentUri) || isLikedSongsPage(currentUri) || isLocalFilesPage(currentUri));
    
    if (!isValidPlaylistPage && !isSearch) return;

    const tracklistHeader = tracklist_.querySelector('.main-trackList-trackListHeaderRow, [role="row"][aria-rowindex="1"], [role="row"]:has([role="columnheader"])');
    if (!tracklistHeader) return;

    tracklist_.querySelectorAll('.sort-play-album-col-header, .sort-play-album-col, .sort-play-artist-header-wrapper, .sort-play-artist-col').forEach(el => el.remove());

    const currentPlaylistName = getCurrentPlaylistName();
    const isExcludedPlaylist = excludedPlaylistNames.includes(currentPlaylistName);
    const shouldRemoveDateAdded = !isSearch && removeDateAdded && !isExcludedPlaylist;

    const nativeHeaders = Array.from(tracklistHeader.querySelectorAll('[role="columnheader"]'))
        .filter(el => !el.classList.contains('sort-play-column') && !el.classList.contains('sort-play-second-column'));
    
    if (nativeHeaders.length === 0) return;
    
    const endHeaderCell = tracklistHeader.querySelector(".main-trackList-rowSectionEnd") || tracklistHeader.lastElementChild;
    let dateAddedHeaderCell = nativeHeaders.find(el => {
        const txt = el.textContent || '';
        return txt.includes('Date added') || txt.includes('Date Added') || txt.includes('Added');
    }) || null;
    if (!dateAddedHeaderCell) {
        const variableHeaders = nativeHeaders.filter(el => el.classList.contains('main-trackList-rowSectionVariable'));
        if (variableHeaders.length > 0) dateAddedHeaderCell = variableHeaders[variableHeaders.length - 1];
    }

    const dateAddedIndexAttr = dateAddedHeaderCell ? dateAddedHeaderCell.getAttribute("aria-colindex") : null;
    const skeletonDateAddedIndex = nativeHeaders.indexOf(dateAddedHeaderCell);

    let existingHeaderColumn = tracklistHeader.querySelector(".sort-play-column");
    const headerTextSpan = existingHeaderColumn?.querySelector("span");
    let existingSecondHeaderColumn = tracklistHeader.querySelector(".sort-play-second-column");
    const secondHeaderTextSpan = existingSecondHeaderColumn?.querySelector("span");

    const expectedHeaderText = {
        'playCount': "Plays", 'popularity': "Popularity", 'releaseDate': "Rel. Date", 'trueReleaseDate': "True Date",
        'scrobbles': "Scrobbles", 'personalScrobbles': myScrobblesDisplayMode === 'sign' ? "Listened" : "My Scrobbles",
        'lastScrobbled': "Last Played", 'djInfo': "DJ Info", 'key': "Key", 'tempo': "BPM", 'energy': "Energy",
        'danceability': "Dance", 'valence': "Valence", 'genre': "Genre"
    }[selectedColumnType] || "Plays";
    const columnTypeChanged = existingHeaderColumn && headerTextSpan?.innerText !== expectedHeaderText;

    const expectedSecondHeaderText = {
        'playCount': "Plays", 'popularity': "Popularity", 'releaseDate': "Rel. Date", 'trueReleaseDate': "True Date",
        'scrobbles': "Scrobbles", 'personalScrobbles': myScrobblesDisplayMode === 'sign' ? "Listened" : "My Scrobbles",
        'lastScrobbled': "Last Played", 'djInfo': "DJ Info", 'key': "Key", 'tempo': "BPM", 'energy': "Energy",
        'danceability': "Dance", 'valence': "Valence", 'genre': "Genre"
    }[selectedSecondColumnType] || "Popularity";
    const secondColumnTypeChanged = existingSecondHeaderColumn && secondHeaderTextSpan?.innerText !== expectedSecondHeaderText;

    if (dateAddedHeaderCell) {
        dateAddedHeaderCell.style.display = shouldRemoveDateAdded ? 'none' : '';
    }

    const createHeaderColumn = (className, headerText, contextType) => {
        const headerColumn = document.createElement("div");
        headerColumn.className = `main-trackList-rowSectionVariable ${className}`;
        headerColumn.setAttribute("role", "columnheader");
        headerColumn.style.cssText = "display: flex; justify-content: center; align-items: center;";
        
        const btn = document.createElement("button");
        btn.className = "sort-play-column-header";
        btn.onclick = (e) => showColumnSelector(e, contextType);
        const title = document.createElement("span");
        title.className = "TypeElement-mesto-type standalone-ellipsis-one-line";
        title.innerText = headerText;
        btn.appendChild(title);
        headerColumn.appendChild(btn);
        return headerColumn;
    };

    if (showAdditionalColumn) {
        if (!existingHeaderColumn) {
            const headerColumn = createHeaderColumn('sort-play-column', expectedHeaderText, 'playlist1');
            if (endHeaderCell) tracklistHeader.insertBefore(headerColumn, endHeaderCell);
            else tracklistHeader.appendChild(headerColumn);
            existingHeaderColumn = headerColumn;
        } else if (columnTypeChanged) {
            if (headerTextSpan) headerTextSpan.innerText = expectedHeaderText;
            tracklist_.querySelectorAll('.sort-play-data').forEach(cell => { 
                cell.textContent = ""; 
                delete cell.dataset.spProcessed; 
                cell.onclick = null;
                cell.onmouseover = null;
                cell.onmouseout = null;
                cell.style.cursor = "default";
                cell.style.textDecoration = "none";
                cell.removeAttribute('title');
            });
        }
    } else if (existingHeaderColumn) {
        existingHeaderColumn.remove();
        existingHeaderColumn = null;
    }

    if (showSecondAdditionalColumn) {
        if (!existingSecondHeaderColumn) {
            const headerColumn = createHeaderColumn('sort-play-second-column', expectedSecondHeaderText, 'playlist2');
            const firstExtra = tracklistHeader.querySelector(".sort-play-column");
            const insertBeforeNode = firstExtra || endHeaderCell;
            if (insertBeforeNode) tracklistHeader.insertBefore(headerColumn, insertBeforeNode);
            else tracklistHeader.appendChild(headerColumn);
            existingSecondHeaderColumn = headerColumn;
        } else if (secondColumnTypeChanged) {
            if (secondHeaderTextSpan) secondHeaderTextSpan.innerText = expectedSecondHeaderText;
            tracklist_.querySelectorAll('.sort-play-second-data').forEach(cell => { 
                cell.textContent = ""; 
                delete cell.dataset.spProcessed; 
                cell.onclick = null;
                cell.onmouseover = null;
                cell.onmouseout = null;
                cell.style.cursor = "default";
                cell.style.textDecoration = "none";
                cell.removeAttribute('title');
            });
        }
    } else if (existingSecondHeaderColumn) {
        existingSecondHeaderColumn.remove();
        existingSecondHeaderColumn = null;
    }

    const headerChildren = Array.from(tracklistHeader.children);
    const sp1HeaderIndex = existingHeaderColumn ? headerChildren.indexOf(existingHeaderColumn) : -1;
    const sp2HeaderIndex = existingSecondHeaderColumn ? headerChildren.indexOf(existingSecondHeaderColumn) : -1;

    let currentHeaderCols = Array.from(tracklistHeader.querySelectorAll('[role="columnheader"]')).filter(el => el.style.display !== 'none');
    currentHeaderCols.forEach((el, index) => {
        const newIndex = (index + 1).toString();
        if (el.getAttribute("aria-colindex") !== newIndex) {
            el.setAttribute("aria-colindex", newIndex);
        }
    });
    
    const createDataColumn = (className, dataClassName) => {
        const dataColumn = document.createElement("div");
        dataColumn.className = `main-trackList-rowSectionVariable ${className}`;
        dataColumn.setAttribute("role", "gridcell");
        dataColumn.style.cssText = "display: flex; justify-content: center; align-items: center;";
        dataColumn.innerHTML = `<span class="${dataClassName}" style="font-size: 14px; font-weight: 400; color: var(--spice-subtext);"></span>`;
        return dataColumn;
    };

    const skeletonRows = tracklist_.querySelectorAll(".main-trackList-trackListRowGrid:not(.main-trackList-trackListRow):not(.main-trackList-trackListHeaderRow)");
    for (const skeleton of skeletonRows) {
        if (skeletonDateAddedIndex !== -1 && skeletonDateAddedIndex < skeleton.children.length) {
            const skeletonDateAddedCell = skeleton.children[skeletonDateAddedIndex];
            if (skeletonDateAddedCell && skeletonDateAddedCell.classList.contains("main-trackList-rowSectionVariable")) {
                skeletonDateAddedCell.style.display = shouldRemoveDateAdded ? 'none' : '';
            }
        }

        const endCell = skeleton.querySelector(".main-trackList-rowSectionEnd");
        const existingExtra = skeleton.querySelector(".sort-play-skeleton-col");
        const existingSecondExtra = skeleton.querySelector(".sort-play-second-skeleton-col");

        if (showAdditionalColumn) {
            if (!existingExtra) {
                const skeletonCell = document.createElement("div");
                const varCell = skeleton.querySelector(".main-trackList-rowSectionVariable");
                const baseClass = varCell ? varCell.className.split(' ').filter(c => !c.includes('sort-play')).join(' ') : "ojrBmBNrA3EfuQlTYybV main-trackList-rowSectionVariable r5OS0NnS9c7LAEJKIri1";
                skeletonCell.className = `${baseClass} sort-play-skeleton-col`;
                if (endCell) skeleton.insertBefore(skeletonCell, endCell);
                else skeleton.appendChild(skeletonCell);
            }
        } else if (existingExtra) {
            existingExtra.remove();
        }

        if (showSecondAdditionalColumn) {
            if (!existingSecondExtra) {
                const skeletonCell = document.createElement("div");
                const varCell = skeleton.querySelector(".main-trackList-rowSectionVariable");
                const baseClass = varCell ? varCell.className.split(' ').filter(c => !c.includes('sort-play')).join(' ') : "ojrBmBNrA3EfuQlTYybV main-trackList-rowSectionVariable r5OS0NnS9c7LAEJKIri1";
                skeletonCell.className = `${baseClass} sort-play-second-skeleton-col`;
                
                const firstExtra = skeleton.querySelector(".sort-play-skeleton-col");
                const insertBeforeNode = firstExtra || endCell;
                if (insertBeforeNode) skeleton.insertBefore(skeletonCell, insertBeforeNode);
                else skeleton.appendChild(skeletonCell);
            }
        } else if (existingSecondExtra) {
            existingSecondExtra.remove();
        }
    }
    
    const allRows = Array.from(tracklist_.querySelectorAll('.main-trackList-trackListRow, [role="row"]:not([aria-rowindex="1"])')).filter(r => r !== tracklistHeader);
    for (const track of allRows) {
        const cellContainer = (track.children.length === 1 && track.firstElementChild?.querySelector('[role="gridcell"]')) ? track.firstElementChild : track;
        let existingDataColumn = cellContainer.querySelector(".sort-play-data-column");
        let existingSecondDataColumn = cellContainer.querySelector(".sort-play-second-data-column");
        
        const dateAddedCell = dateAddedIndexAttr ? cellContainer.querySelector(`[aria-colindex="${dateAddedIndexAttr}"]`) : null;
        if (dateAddedCell && !dateAddedCell.classList.contains('sort-play-data-column') && !dateAddedCell.classList.contains('sort-play-second-data-column')) {
            dateAddedCell.style.display = shouldRemoveDateAdded ? 'none' : '';
        }

        if (showSecondAdditionalColumn) {
            if (!existingSecondDataColumn) {
                existingSecondDataColumn = createDataColumn('sort-play-second-data-column sort-play-second-column', 'sort-play-second-data');
            } else if (secondColumnTypeChanged) {
                const dataSpan = existingSecondDataColumn.querySelector('.sort-play-second-data');
                if (dataSpan) {
                    dataSpan.textContent = "";
                    delete dataSpan.dataset.spProcessed;
                    dataSpan.onclick = null;
                    dataSpan.onmouseover = null;
                    dataSpan.onmouseout = null;
                    dataSpan.style.cursor = "default";
                    dataSpan.style.textDecoration = "none";
                    dataSpan.removeAttribute('title');
                }
            }
            const targetNode = cellContainer.children[sp2HeaderIndex];
            if (targetNode && existingSecondDataColumn !== targetNode) {
                cellContainer.insertBefore(existingSecondDataColumn, targetNode);
            } else if (!targetNode && existingSecondDataColumn.parentElement !== cellContainer) {
                cellContainer.appendChild(existingSecondDataColumn);
            }
        } else if (existingSecondDataColumn) {
            existingSecondDataColumn.remove();
        }

        if (showAdditionalColumn) {
            if (!existingDataColumn) {
                existingDataColumn = createDataColumn('sort-play-data-column sort-play-column', 'sort-play-data');
            } else if (columnTypeChanged) {
                const dataSpan = existingDataColumn.querySelector('.sort-play-data');
                if (dataSpan) {
                    dataSpan.textContent = "";
                    delete dataSpan.dataset.spProcessed;
                    dataSpan.onclick = null;
                    dataSpan.onmouseover = null;
                    dataSpan.onmouseout = null;
                    dataSpan.style.cursor = "default";
                    dataSpan.style.textDecoration = "none";
                    dataSpan.removeAttribute('title');
                }
            }
            const targetNode = cellContainer.children[sp1HeaderIndex];
            if (targetNode && existingDataColumn !== targetNode) {
                cellContainer.insertBefore(existingDataColumn, targetNode);
            } else if (!targetNode && existingDataColumn.parentElement !== cellContainer) {
                cellContainer.appendChild(existingDataColumn);
            }
        } else if (existingDataColumn) {
            existingDataColumn.remove();
        }
    }
    syncNativeTracklistLayout(tracklist_);
  }