import {
	decorateIcons,
	fetchPlaceholders
} from '../../scripts/aem.js';
import {
	a, div, li, p, span, ul, input, domEl
} from '../../scripts/dom-helpers.js';

const searchParams = new URLSearchParams( window.location.search );

/**
 * Highlights search terms within text elements by wrapping them in <mark> tags
 * @param {string[]} terms - Array of search terms to highlight
 * @param {HTMLElement[]} elements - Array of elements to search within
 */
function highlightTextElements( terms, elements ) {
	elements.forEach( ( element ) => {
		if ( !element || !element.textContent ) return;

		const matches = [];
		const { textContent } = element;
		terms.forEach( ( term ) => {
			let start = 0;
			let offset = textContent.toLowerCase().indexOf( term.toLowerCase(), start );
			while ( offset >= 0 ) {
				matches.push( { offset, term: textContent.substring( offset, offset + term.length ) } );
				start = offset + term.length;
				offset = textContent.toLowerCase().indexOf( term.toLowerCase(), start );
			}
		} );

		if ( !matches.length ) {
			return;
		}

		matches.sort( ( a, b ) => a.offset - b.offset );
		let currentIndex = 0;
		const fragment = matches.reduce( ( acc, { offset, term } ) => {
			if ( offset < currentIndex ) return acc;
			const textBefore = textContent.substring( currentIndex, offset );
			if ( textBefore ) {
				acc.appendChild( document.createTextNode( textBefore ) );
			}
			const markedTerm = domEl( 'mark', term );
			acc.appendChild( markedTerm );
			currentIndex = offset + term.length;
			return acc;
		}, document.createDocumentFragment() );
		const textAfter = textContent.substring( currentIndex );
		if ( textAfter ) {
			fragment.appendChild( document.createTextNode( textAfter ) );
		}
		element.innerHTML = '';
		element.appendChild( fragment );
	} );
}

/**
 * Fetches data from the specified source URL
 * @param {string} source - URL to fetch data from
 * @returns {Promise<Object|null>} - JSON data or null if fetch fails
 */
export async function fetchData( source ) {
	const response = await fetch( source );
	if ( !response.ok ) {
		// eslint-disable-next-line no-console
		console.error( 'error loading API response', response );
		return null;
	}

	const json = await response.json();
	if ( !json ) {
		// eslint-disable-next-line no-console
		console.error( 'empty API response', source );
		return null;
	}

	return json.data;
}

/**
 * Renders a single search result item using the USA collection item template
 * @param {Object} result - The search result data
 * @param {string[]} searchTerms - Terms to highlight in the result
 * @param {string} titleTag - HTML tag to use for the result title
 * @returns {HTMLElement} - The rendered search result list item
 */
function renderResult( result, searchTerms, titleTag ) {
	const resultItem = li( { class: 'usa-collection__item' } );

	// Create collection body container
	const collectionBody = div( { class: 'usa-collection__body' } );

	// Add title
	if ( result.title ) {
		const titleLink = a( { href: result.path, class: 'usa-link' }, result.title );
		highlightTextElements( searchTerms, [titleLink] );
		const heading = domEl( titleTag, { class: 'usa-collection__heading' }, titleLink );
		collectionBody.appendChild( heading );
	}

	// Add description
	if ( result.description ) {
		const description = p( { class: 'usa-collection__description' }, result.description );
		highlightTextElements( searchTerms, [description] );
		collectionBody.appendChild( description );
	}

	// Add tags if available
	if ( result.tags && result.tags.length > 0 ) {
		const tagsList = ul( { class: 'usa-collection__meta', 'aria-label': 'Topics' } );

		result.tags.forEach( ( tag, index ) => {
			const tagClass = index === 0 && result.isNew ? 'usa-collection__meta-item usa-tag usa-tag--new' : 'usa-collection__meta-item usa-tag';
			tagsList.appendChild( li( { class: tagClass }, tag ) );
		} );

		collectionBody.appendChild( tagsList );
	}

	resultItem.appendChild( collectionBody );
	return resultItem;
}

/**
 * Clears the search results container
 * @param {HTMLElement} block - The search block element
 */
function clearSearchResults( block ) {
	const searchResults = block.querySelector( '.search-results' );
	searchResults.innerHTML = '';
}

/**
 * Clears search results and resets URL parameters
 * @param {HTMLElement} block - The search block element
 */
function clearSearch( block ) {
	clearSearchResults( block );
	if ( window.history.replaceState ) {
		const url = new URL( window.location.href );
		url.search = '';
		searchParams.delete( 'q' );
		window.history.replaceState( {}, '', url.toString() );
	}
}

/**
 * Renders search results in the search block
 * @param {HTMLElement} block - The search block element
 * @param {Object} config - Configuration object with placeholders
 * @param {Array} filteredData - Filtered search results
 * @param {string[]} searchTerms - Search terms to highlight
 */
async function renderResults( block, config, filteredData, searchTerms ) {
	clearSearchResults( block );
	const searchResults = block.querySelector( '.search-results' );
	const headingTag = searchResults.dataset.h;

	if ( filteredData.length ) {
		searchResults.classList.remove( 'no-results' );
		filteredData.forEach( ( result ) => {
			searchResults.append( renderResult( result, searchTerms, headingTag ) );
		} );
	} else {
		searchResults.classList.add( 'no-results' );
		searchResults.append( li( { class: 'usa-collection__item' }, config.placeholders.searchNoResults || 'No results found.' ) );
	}
}

/**
 * Comparison function for sorting search results by match position
 * @param {Object} hit1 - First search hit with minIdx property
 * @param {Object} hit2 - Second search hit with minIdx property
 * @returns {number} - Comparison result for sorting
 */
function compareFound( hit1, hit2 ) {
	return hit1.minIdx - hit2.minIdx;
}

/**
 * Filters data based on search terms
 * @param {string[]} searchTerms - Array of search terms
 * @param {Array} data - Data to filter
 * @returns {Array} - Filtered data sorted by relevance
 */
function filterData( searchTerms, data ) {
	const foundInHeader = [];
	const foundInMeta = [];

	data.forEach( ( result ) => {
		let minIdx = -1;

		searchTerms.forEach( ( term ) => {
			const idx = ( result.header || result.title ).toLowerCase().indexOf( term );
			if ( idx < 0 ) return;
			if ( minIdx < idx ) minIdx = idx;
		} );

		if ( minIdx >= 0 ) {
			foundInHeader.push( { minIdx, result } );
			return;
		}

		const metaContents = `${result.title} ${result.description} ${result.path.split( '/' ).pop()} ${result.tags?.join( ' ' )} ${result.keywords} ${result.h2s?.join( ' ' )} ${result.body}`.toLowerCase();
		searchTerms.forEach( ( term ) => {
			const idx = metaContents.indexOf( term );
			if ( idx < 0 ) return;
			if ( minIdx < idx ) minIdx = idx;
		} );

		if ( minIdx >= 0 ) {
			foundInMeta.push( { minIdx, result } );
		}
	} );

	return [
		...foundInHeader.sort( compareFound ),
		...foundInMeta.sort( compareFound ),
	].map( ( item ) => item.result );
}

/**
 * Handles search input events
 * @param {Event} e - Input event
 * @param {HTMLElement} block - The search block element
 * @param {Object} config - Configuration object
 */
async function handleSearch( e, block, config ) {
	const searchValue = e.target.value;
	searchParams.set( 'q', searchValue );
	if ( window.history.replaceState ) {
		const url = new URL( window.location.href );
		url.search = searchParams.toString();
		window.history.replaceState( {}, '', url.toString() );
	}

	if ( searchValue.length < 3 ) {
		clearSearch( block );
		return;
	}
	const searchTerms = searchValue.toLowerCase().split( /\s+/ ).filter( ( term ) => !!term );

	const data = await fetchData( config.source );
	const filteredData = filterData( searchTerms, data );
	await renderResults( block, config, filteredData, searchTerms );
}

/**
 * Creates a container for search results
 * @param {HTMLElement} block - The search block element
 * @returns {HTMLElement} - The search results container element
 */
function searchResultsContainer() {
	let container = ul( {
		class: 'search-results usa-collection',
	} );
	container.dataset.h = 'H4';
	return container;
}

/**
 * Creates the search input field
 * @param {HTMLElement} block - The search block element
 * @param {Object} config - Configuration object with placeholders
 * @returns {HTMLElement} - The search input element
 */
function searchInput( block, config ) {
	const searchPlaceholder = ( config.placeholders.searchPlaceholder || 'Search' ) + '...';

	const searchInputEl = input( {
		type: 'search',
		class: 'usa-input usa-text-input',
		id: 'search-block-field',
		name: 'q',
		placeholder: searchPlaceholder,
		'aria-label': searchPlaceholder,
		oninput: ( e ) => handleSearch( e, block, config ),
		onkeyup: ( e ) => { if ( e.code === 'Escape' ) { clearSearch( block ); } }
	} );

	return searchInputEl;
}

/**
 * Creates the search icon element
 * @returns {HTMLElement} - The search icon element
 */
function searchIcon( config ) {
	const searchTxt = config.placeholders.searchPlaceholder || 'Search';
	return domEl( 'button', { class: 'usa-button', type: 'submit' },
		span( { class: 'usa-search__submit-text' }, searchTxt ),
		domEl( 'img', { class: 'usa-search__submit-icon', alt: searchTxt, src: '../../icons/usa-icons-bg/search--white.svg' } )
	);
}

/**
 * Creates the search box container with input and icon
 * @param {HTMLElement} block - The search block element
 * @param {Object} config - Configuration object
 * @returns {HTMLElement} - The search box container
 */
function searchBox( block, config ) {
	return domEl( 'form', { class: 'usa-search usa-search--big', role: 'search' },
		domEl( 'label', { class: 'usa-sr-only', for: 'search-block-field' } ),
		searchInput( block, config ),
		searchIcon( config )
	);
}

/**
 * Decorates the search block with search functionality
 * @param {HTMLElement} block - The block element to decorate
 */
export default async function decorate( block ) {
	const placeholders = await fetchPlaceholders();
	const source = block.querySelector( 'a[href]' ) ? block.querySelector( 'a[href]' ).href : '/query-index.json';
	const manualCollection = domEl( 'div', {class: 'manual-collection' }, searchResultsContainer( block ) );
	block.innerHTML = '';
	block.append(
		searchBox( block, { source, placeholders } ),
		manualCollection
	);
	
	

	if ( searchParams.get( 'q' ) ) {
		const input = block.querySelector( 'input' );
		input.value = searchParams.get( 'q' );
		input.dispatchEvent( new Event( 'input' ) );
	}

	decorateIcons( block );
}
