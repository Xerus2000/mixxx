#prargma once

#include <QItemDelegate>
#include <QLinkedList>
#include <QList>
#include <QtSql>

#include "library/dao/settingsdao.h"
#include "track/track.h"
#include "track/trackref.h"

/// Pure virtual (abstract) class that provides an interface for data models
/// which display track lists.
class TrackModel {
  public:
    static const int kHeaderWidthRole = Qt::UserRole + 0;
    static const int kHeaderNameRole = Qt::UserRole + 1;

    TrackModel(QSqlDatabase db,
            const char* settingsNamespace)
            : m_db(db),
              m_settingsNamespace(settingsNamespace),
              m_iDefaultSortColumn(-1),
              m_eDefaultSortOrder(Qt::AscendingOrder) {
    }

    virtual ~TrackModel() {
    }

    // These enums are the bits in a bitvector. Any individual column cannot
    // have a value other than 0, 1, 2, 4, or 8!
    // clang-format off
    enum Capabilities {
        TRACKMODELCAPS_NONE              = 0u,
        TRACKMODELCAPS_REORDER           = 1u <<  0u,
        TRACKMODELCAPS_RECEIVEDROPS      = 1u <<  1u,
        TRACKMODELCAPS_ADDTOTRACKSET     = 1u <<  2u,
        TRACKMODELCAPS_ADDTOAUTODJ       = 1u <<  3u,
        TRACKMODELCAPS_LOCKED            = 1u <<  4u,
        TRACKMODELCAPS_EDITMETADATA      = 1u <<  5u,
        TRACKMODELCAPS_LOADTODECK        = 1u <<  6u,
        TRACKMODELCAPS_LOADTOSAMPLER     = 1u <<  7u,
        TRACKMODELCAPS_LOADTOPREVIEWDECK = 1u <<  8u,
        TRACKMODELCAPS_REMOVE            = 1u <<  9u,
        TRACKMODELCAPS_RESETPLAYED       = 1u << 10u,
        TRACKMODELCAPS_HIDE              = 1u << 11u,
        TRACKMODELCAPS_UNHIDE            = 1u << 12u,
        TRACKMODELCAPS_PURGE             = 1u << 13u,
        TRACKMODELCAPS_REMOVE_PLAYLIST   = 1u << 14u,
        TRACKMODELCAPS_REMOVE_CRATE      = 1u << 15u,
    };
    /// Enables the use of bitwise operators
    typedef unsigned int CapabilitiesFlags;

    enum SortColumnId {
        SORTCOLUMN_INVALID = -1,
        SORTCOLUMN_ARTIST = 0,
        SORTCOLUMN_TITLE,
        SORTCOLUMN_ALBUM,
        SORTCOLUMN_ALBUMARTIST,
        SORTCOLUMN_YEAR,
        SORTCOLUMN_GENRE,
        SORTCOLUMN_COMPOSER,
        SORTCOLUMN_GROUPING,
        SORTCOLUMN_TRACKNUMBER,
        SORTCOLUMN_FILETYPE,
        SORTCOLUMN_NATIVELOCATION,
        SORTCOLUMN_COMMENT,
        SORTCOLUMN_DURATION,
        SORTCOLUMN_BITRATE,
        SORTCOLUMN_BPM,
        SORTCOLUMN_REPLAYGAIN,
        SORTCOLUMN_DATETIMEADDED,
        SORTCOLUMN_TIMESPLAYED,
        SORTCOLUMN_RATING,
        SORTCOLUMN_KEY,
        SORTCOLUMN_PREVIEW,
        SORTCOLUMN_COVERART,
        SORTCOLUMN_POSITION,
        SORTCOLUMN_PLAYLISTID,
        SORTCOLUMN_LOCATION,
        SORTCOLUMN_FILENAME,
        SORTCOLUMN_FILE_MODIFIED_TIME,
        SORTCOLUMN_FILE_CREATION_TIME,
        SORTCOLUMN_SAMPLERATE,
        SORTCOLUMN_COLOR,

        // NUM_SORTCOLUMNS should always be the last item.
        NUM_SORTCOLUMNIDS
    };

    // Deserialize and return the track at the given QModelIndex
    // or TrackRef in this result set.
    virtual TrackPointer getTrack(const QModelIndex& index) const = 0;
    virtual TrackPointer getTrackByRef(const TrackRef& trackRef) const = 0;

    // Gets the on-disk location of the track at the given location
    // with Qt separator "/".
    // Use QDir::toNativeSeparators() before displaying this to a user.
    virtual QString getTrackLocation(const QModelIndex& index) const = 0;

    // Gets the track ID of the track at the given QModelIndex
    virtual TrackId getTrackId(const QModelIndex& index) const = 0;

    // Gets the rows of the track in the current result set. Returns an
    // empty list if the track ID is not present in the result set.
    virtual const QLinkedList<int> getTrackRows(TrackId trackId) const = 0;

    bool isTrackModel() { return true;}
    virtual void search(const QString& searchText, const QString& extraFilter=QString()) = 0;
    virtual const QString currentSearch() const = 0;
    virtual bool isColumnInternal(int column) = 0;
    // if no header state exists, we may hide some columns so that the user can
    // reactivate them
    virtual bool isColumnHiddenByDefault(int column) = 0;
    virtual const QList<int>& showableColumns() const { return m_emptyColumns; }
    virtual const QList<int>& searchColumns() const { return m_emptyColumns; }

    virtual void removeTracks(const QModelIndexList& indices) {
        Q_UNUSED(indices);
    }
    virtual void hideTracks(const QModelIndexList& indices) {
        Q_UNUSED(indices);
    }
    virtual void unhideTracks(const QModelIndexList& indices) {
        Q_UNUSED(indices);
    }
    virtual void purgeTracks(const QModelIndexList& indices) {
        Q_UNUSED(indices);
    }
    virtual int addTracks(const QModelIndex& index, const QList<QString>& locations) {
        Q_UNUSED(index);
        Q_UNUSED(locations);
        return 0;
    }
    virtual void moveTrack(const QModelIndex& sourceIndex,
                           const QModelIndex& destIndex) {
        Q_UNUSED(sourceIndex);
        Q_UNUSED(destIndex);
    }
    virtual bool isLocked() {
        return false;
    }
    virtual QAbstractItemDelegate* delegateForColumn(const int i, QObject* pParent) {
        Q_UNUSED(i);
        Q_UNUSED(pParent);
        return NULL;
    }
    virtual TrackModel::CapabilitiesFlags getCapabilities() const {
        return TRACKMODELCAPS_NONE;
    }
    virtual bool hasCapabilities(TrackModel::CapabilitiesFlags caps) const {
        Q_UNUSED(caps);
        return false;
    }
    virtual QString getModelSetting(QString name) {
        SettingsDAO settings(m_db);
        QString key = m_settingsNamespace + "." + name;
        return settings.getValue(key);
    }

    virtual bool setModelSetting(QString name, QVariant value) {
        SettingsDAO settings(m_db);
        QString key = m_settingsNamespace + "." + name;
        return settings.setValue(key, value);
    }

    virtual int defaultSortColumn() const {
        return m_iDefaultSortColumn;
    }

    virtual Qt::SortOrder defaultSortOrder() const {
        return m_eDefaultSortOrder;
    }

    virtual void setDefaultSort(int sortColumn, Qt::SortOrder sortOrder) {
        m_iDefaultSortColumn = sortColumn;
        m_eDefaultSortOrder = sortOrder;
    }

    virtual bool isColumnSortable(int column) {
        Q_UNUSED(column);
        return true;
    }

    virtual SortColumnId sortColumnIdFromColumnIndex(int index) {
        Q_UNUSED(index);
        return SORTCOLUMN_INVALID;

    }

    virtual int columnIndexFromSortColumnId(TrackModel::SortColumnId sortColumn) {
        Q_UNUSED(sortColumn);
        return -1;
    }

    virtual int fieldIndex(const QString& fieldName) const {
        Q_UNUSED(fieldName);
        return -1;
    }

    virtual void select() {
    }

  private:
    QSqlDatabase m_db;
    QString m_settingsNamespace;
    QList<int> m_emptyColumns;
    int m_iDefaultSortColumn;
    Qt::SortOrder m_eDefaultSortOrder;
};
